import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat, unlink } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { parseFrontmatter, parseYamlScalar, readBoolean, readFrontmatterValue } from '#lib/frontmatter.js';
import { canonicalBody, hashPostContent, splitRawPost } from '#lib/post-text.js';
import { slugify, svxSlug } from '#lib/svx.js';
import { classifyLlmDrafts, llmImportPlan, llmOwnerPath, llmUserPath, standaloneLlmFiles, type LlmFile } from '#lib/llm-drafts.js';
import {
	appendRevision,
	deletePostRows,
	getEditingOrder,
	getTriage,
	getMetaValue,
	getStoredPost,
	ingestAssistantFile,
	listMetaKeys,
	listStoredPosts,
	seedEditingQueue,
	setExportedState,
	setMetaValue,
	upsertVersion,
	type StoredPost
} from './db';
import { getDeployStatus, readDeployState, type DeployState, type DeployStatus } from './deploy-state';
import type { Effort, Triage } from '#lib/types.js';
import { ensureCorpusImported, ensureCorpusImportedLocked } from './import-corpus';
import {
	ensureSiteBaseRepaired, ensureSiteBaseRepairedLocked, ensureSvxBaseline, ensureSvxBaselineLocked
} from './import-svx';
import {
	assertCheckoutReadLock, CheckoutBusyError, withCheckoutLock, withCheckoutReadLock
} from './checkout-lock';
import { commitPaths } from './git';
import { assertNoPendingPublishMutation } from './publish-push';
import { contentBaseDirectory, contentDirectory } from './paths';
import { decideSave, normalizeNewlines, type SaveDecision } from '#lib/save-rules.js';

export { splitRawPost };

export type PostSummary = {
	id?: string;
	path: string;
	title: string;
	date: string;
	tags: string[];
	publish: boolean;
	pin: boolean;
	editingOrder: number | null;
	nextStep: string | null;
	effort: Effort | null;
	triageRev: number;
	deleteRequested: boolean;
	slug: string;
	excerpt: string;
	updatedAt: string;
	contentHash: string;
	deployStatus: DeployStatus;
	deployedAt?: string;
	baselineCommit: string | null;
};

export type Post = PostSummary & {
	frontmatter: string;
	body: string;
};

const isMarkdownFile = (filePath: string) => filePath.endsWith('.md');

const normalizePostPath = (postPath: string) => postPath.replaceAll('\\', '/');

export const getPostFilePath = (postPath: string) => {
	if (isAbsolute(postPath)) throw new Error('Post path must be relative to the content directory');

	const resolved = resolve(contentDirectory, postPath);

	if (resolved !== contentDirectory && !resolved.startsWith(`${contentDirectory}${sep}`)) {
		throw new Error('Post path must stay inside the content directory');
	}

	if (!isMarkdownFile(resolved)) {
		throw new Error('Post path must end in .md');
	}

	return resolved;
};

export const canonicalPostPath = (postPath: string) => normalizePostPath(relative(contentDirectory, getPostFilePath(postPath)));

export const getPostGitPath = (postPath: string) => normalizePostPath(relative(contentBaseDirectory, getPostFilePath(postPath)));

const readTags = (frontmatter: string) => {
	const raw = readFrontmatterValue(frontmatter, 'tags');
	const value = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw;

	return value
		.split(',')
		.map((tag) => parseYamlScalar(tag))
		.filter(Boolean);
};

const getExcerpt = (body: string) =>
	body
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find((line) => line && !line.startsWith('#'))
		?.slice(0, 160) ?? '';

const postFromStored = (
	stored: PostSource,
	deployState: DeployState,
	editingOrder: Map<string, number>,
	triage: Map<string, Triage>
): Post => {
	const { path, frontmatter, body } = stored;
	const fallbackTitle = path.replace(/\.md$/, '').split('/').at(-1)?.replaceAll('-', ' ') ?? 'Untitled';
	const publish = readBoolean(frontmatter, 'publish');
	const deleteRequested = readBoolean(frontmatter, 'delete') || readBoolean(frontmatter, 'deleted');
	const deployed = deployState.posts[path];

	return {
		path,
		id: stored.id,
		title: readFrontmatterValue(frontmatter, 'title') || fallbackTitle,
		date: readFrontmatterValue(frontmatter, 'date'),
		tags: readTags(frontmatter),
		publish,
		pin: readBoolean(frontmatter, 'pin') || readBoolean(frontmatter, 'pinned'),
		editingOrder: editingOrder.get(path) ?? null,
		nextStep: triage.get(path)?.nextStep ?? null,
		effort: triage.get(path)?.effort ?? null,
		triageRev: triage.get(path)?.rev ?? 0,
		deleteRequested,
		slug: svxSlug(path, frontmatter),
		excerpt: getExcerpt(body),
		updatedAt: stored.savedAt,
		contentHash: stored.hash,
		deployStatus: getDeployStatus({ publish, deleteRequested, contentHash: stored.hash }, deployed),
		deployedAt: deployed?.deployedAt,
		baselineCommit: deployed?.commit ?? null,
		frontmatter,
		body
	};
};

type PostSource = Pick<StoredPost, 'path' | 'frontmatter' | 'body' | 'savedAt' | 'hash'> & { id?: string };

const readLlmFile = async (postPath: string): Promise<PostSource> => {
	const filePath = getPostFilePath(postPath);
	const { frontmatter, body } = splitRawPost(await readFile(filePath, 'utf8'));
	const metadata = await stat(filePath);
	return { path: postPath, frontmatter, body, savedAt: metadata.mtime.toISOString(), hash: hashPostContent(frontmatter, body) };
};

export const listContentFiles = () => listMarkdownFiles(contentDirectory);

const listMarkdownFiles = async (directory: string): Promise<string[]> => {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = await Promise.all(
		entries.map(async (entry) => {
			const filePath = resolve(directory, entry.name);

			if (entry.isDirectory()) return listMarkdownFiles(filePath);
			if (entry.isFile() && isMarkdownFile(filePath)) return [filePath];
			return [];
		})
	);

	return files.flat();
};

const ingestUserFile = async (postPath: string, filePath: string, stored: StoredPost | null) => {
	const meta = await stat(filePath);
	if (stored && stored.exportedMtimeMs === meta.mtimeMs) return;

	const raw = normalizeNewlines(await readFile(filePath, 'utf8'));
	const { frontmatter, body } = splitRawPost(raw);
	const hash = hashPostContent(frontmatter, body);

	if (!stored) {
		appendRevision(postPath, frontmatter.trim(), canonicalBody(body), hash, 'import');
		setExportedState(postPath, hash, meta.mtimeMs);
		return;
	}

	if (hash !== stored.exportedHash && hash !== stored.hash) {
		upsertVersion({
			path: postPath,
			writer: 'ext',
			sessionId: 'file',
			baseHash: stored.exportedHash ?? stored.hash,
			frontmatter: frontmatter.trim(),
			body: canonicalBody(body)
		});
	}
	setExportedState(postPath, hash, meta.mtimeMs);
};

const ingestLlmFile = async (llmPath: string, filePath: string, stored: StoredPost | null) => {
	if (!stored) return;
	const meta = await stat(filePath);

	const raw = normalizeNewlines(await readFile(filePath, 'utf8'));
	const { frontmatter, body } = splitRawPost(raw);
	const hash = hashPostContent(frontmatter, body);

	ingestAssistantFile(stored, {
		frontmatter: frontmatter.trim(), body: canonicalBody(body), hash, mtimeMs: meta.mtimeMs
	});
};

const listLlmFiles = async (files: string[]): Promise<LlmFile[]> => {
	const llmFiles = await Promise.all(
		files
			.filter((file) => file.endsWith('.llm.md'))
			.map(async (file) => ({
				path: normalizePostPath(relative(contentDirectory, file)),
				mtimeMs: (await stat(file).catch(() => null))?.mtimeMs ?? 0
			}))
	);
	return llmFiles;
};

const scanContentDir = async (): Promise<string[]> => {
	const files = await listMarkdownFiles(contentDirectory);
	const stored = new Map(listStoredPosts().map((post) => [post.path, post]));
	const postPaths = [...stored.keys()];
	const llmPaths = new Set((await listLlmFiles(files)).map((file) => file.path));

	for (const filePath of files) {
		const postPath = normalizePostPath(relative(contentDirectory, filePath));
		try {
			if (postPath.endsWith('.llm.md')) {
				const owner = llmOwnerPath(postPath, postPaths, llmPaths);
				await ingestLlmFile(postPath, filePath, owner ? (stored.get(owner) ?? null) : null);
			} else {
				await ingestUserFile(postPath, filePath, stored.get(postPath) ?? null);
			}
		} catch {
			// unreadable file must never block the post list — skipped this tick, retried next
		}
	}

	return files;
};

export const initializeContentLocked = async () => {
	await ensureCorpusImportedLocked();
	await ensureSvxBaselineLocked();
	await ensureSiteBaseRepairedLocked();
};

export const listPosts = async () => {
	await ensureCorpusImported();
	await ensureSvxBaseline();
	await ensureSiteBaseRepaired();
	try {
		return await withCheckoutReadLock(listPostsLocked);
	} catch (caught) {
		if (!(caught instanceof CheckoutBusyError)) throw caught;
		return listPostsFromStore();
	}
};

const sortPosts = (posts: Post[]) => posts.sort((first, second) => {
	const firstDate = first.date || first.updatedAt;
	const secondDate = second.date || second.updatedAt;
	return secondDate.localeCompare(firstDate);
});

// The last scan's llm files and the parsed standalone ones, so a store read lists them without touching disk.
let scannedLlm: { files: LlmFile[]; standalone: Map<string, PostSource> } = { files: [], standalone: new Map() };

const isMissingFile = (caught: unknown) => (caught as NodeJS.ErrnoException).code === 'ENOENT';

// A draft deleted between the directory listing and its read is gone, not an error.
const readLlmFileIfPresent = (postPath: string) =>
	readLlmFile(postPath).catch((caught) => {
		if (isMissingFile(caught)) return null;
		throw caught;
	});

const rememberLlmFiles = async (files: string[]) => {
	const llmFiles = await listLlmFiles(files);
	const standalone = standaloneLlmFiles(llmFiles, listStoredPosts().map((post) => post.path));
	const parsed = (await Promise.all(standalone.map((file) => readLlmFileIfPresent(file.path)))).filter((post) => post !== null);
	const vanished = new Set(standalone.map((file) => file.path).filter((path) => !parsed.some((post) => post.path === path)));
	scannedLlm = {
		files: llmFiles.filter((file) => !vanished.has(file.path)),
		standalone: new Map(parsed.map((post) => [post.path, post]))
	};
};

// No lock and no disk read: it serves while the checkout is busy, and it is as fresh as the last scan.
export const listPostsFromStore = async () => {
	const deployState = await readDeployState();
	const order = getEditingOrder();
	const triage = getTriage();
	const stored: PostSource[] = listStoredPosts();
	const standalone = standaloneLlmFiles(scannedLlm.files, stored.map((post) => post.path))
		.flatMap((file) => scannedLlm.standalone.get(file.path) ?? []);
	return sortPosts(stored.concat(standalone).map((post) => postFromStored(post, deployState, order, triage)));
};

let lastScanAt = 0;

export const listPostsLocked = async () => {
	assertCheckoutReadLock();
	lastScanAt = Date.now();
	const files = await scanContentDir();
	await autoImportLlmDrafts(files);
	await rememberLlmFiles(files);
	const posts = await listPostsFromStore();
	const legacyEditPaths = posts.filter((post) => readBoolean(post.frontmatter, 'edit')).map((post) => post.path);
	return seedEditingQueue(legacyEditPaths) ? listPostsFromStore() : posts;
};

export const missScanCooldownMs = 3000;
let missScan: Promise<unknown> | null = null;

// One scan at a time, and none within the cooldown of the last scan, so a burst of misses costs one scan.
const scanOnMiss = async () => {
	if (!missScan && Date.now() - lastScanAt < missScanCooldownMs) return;
	missScan ??= listPosts().finally(() => {
		missScan = null;
	});
	await missScan;
};

// A cached draft whose file was deleted since the last scan is a stale hit, not a post.
const presentPosts = (posts: Post[]) => posts.filter((post) => !post.path.endsWith('.llm.md') || existsSync(getPostFilePath(post.path)));

// A miss may be a file the last scan has not ingested yet, or a draft it no longer finds, so only a miss pays for a scan.
export const findPosts = async (matches: (post: PostSummary) => boolean) => {
	const found = (await listPostsFromStore()).filter(matches);
	const present = presentPosts(found);
	if (present.length > 0 && present.length === found.length) return present;
	await scanOnMiss();
	return presentPosts((await listPostsFromStore()).filter(matches));
};

export const postsRev = (posts: PostSummary[]) =>
	createHash('sha256')
		.update(
			JSON.stringify(
				posts.map((post) => [
					post.path,
					post.contentHash,
					post.editingOrder,
					post.triageRev,
					post.deployStatus,
					post.deleteRequested,
					post.pin
				])
			)
		)
		.digest('hex')
		.slice(0, 16);

export class UnknownPostError extends Error {
	constructor(postPath: string) {
		super(`Unknown post: ${postPath}`);
	}
}

export const getPost = async (postPath: string): Promise<Post> => {
	if (postPath.endsWith('.llm.md')) {
		try {
			return postFromStored(await readLlmFile(postPath), await readDeployState(), getEditingOrder(), getTriage());
		} catch (caught) {
			if (isMissingFile(caught)) throw new UnknownPostError(postPath);
			throw caught;
		}
	}
	const stored = getStoredPost(postPath);
	if (!stored) throw new UnknownPostError(postPath);
	return postFromStored(stored, await readDeployState(), getEditingOrder(), getTriage());
};

const saveChains = new Map<string, Promise<unknown>>();

const chainSave = <T>(postPath: string, work: () => Promise<T>): Promise<T> => {
	const previous = saveChains.get(postPath) ?? Promise.resolve();
	const run = previous.then(work, work);
	const settled = run.then(
		() => undefined,
		() => undefined
	);
	saveChains.set(postPath, settled);
	settled.then(() => {
		if (saveChains.get(postPath) === settled) saveChains.delete(postPath);
	});
	return run;
};

export type SaveResult = { outcome: SaveDecision; post: Post };

export const savePost = (
	postPath: string,
	rawFrontmatter: string,
	rawBody: string,
	baseHash: string,
	writer: string
): Promise<SaveResult> =>
	chainSave(postPath, async () => {
		if (postPath.endsWith('.llm.md')) throw new Error('Fork the llm draft before editing it');
		const frontmatter = normalizeNewlines(rawFrontmatter).trim();
		const body = canonicalBody(normalizeNewlines(rawBody));
		const current = await getPost(postPath);
		const incomingHash = hashPostContent(frontmatter, body);
		const outcome = decideSave(baseHash, current.contentHash, incomingHash);

		if (outcome !== 'write') return { outcome, post: current };

		appendRevision(postPath, frontmatter, body, incomingHash, writer);
		return { outcome, post: await getPost(postPath) };
	});

// A post is born on its first real content, so there is no blank row to clean up later.
export const createPost = (rawFrontmatter: string, rawBody: string, writer: string) =>
	chainSave('create', async () => {
		const frontmatter = normalizeNewlines(rawFrontmatter).trim();
		const body = canonicalBody(normalizeNewlines(rawBody));
		const baseSlug = slugify(parseFrontmatter(frontmatter).title) || 'untitled';
		let postPath = `${baseSlug}.md`;
		const takenSlugs = new Set(listStoredPosts().map((post) => svxSlug(post.path, post.frontmatter)));
		let suffix = 2;

		while (getStoredPost(postPath) || existsSync(getPostFilePath(postPath)) || takenSlugs.has(svxSlug(postPath, ''))) {
			postPath = `${baseSlug}-${suffix}.md`;
			suffix += 1;
		}

		appendRevision(postPath, frontmatter, body, hashPostContent(frontmatter, body), writer);
		return getPost(postPath);
	});

export const createUserVersion = async (llmPath: string) => {
	if (!llmPath.endsWith('.llm.md')) throw new Error('Can only fork .llm.md drafts');
	const userPath = llmUserPath(llmPath);
	if (getStoredPost(userPath)) return { path: userPath, created: false };

	const raw = normalizeNewlines(await readFile(getPostFilePath(llmPath), 'utf8'));
	const frontmatter = splitRawPost(raw)
		.frontmatter.split('\n')
		.filter((line) => !line.match(/^publish:/))
		.join('\n')
		.trim();

	// re-checked after the read: a concurrent import may have created it while this one awaited the file
	if (getStoredPost(userPath)) return { path: userPath, created: false };
	appendRevision(userPath, frontmatter, '', hashPostContent(frontmatter, ''), 'cms');
	return { path: userPath, created: true };
};

const llmAutoImportSinceKey = 'llmAutoImportSince';
const llmImportedPrefix = 'llmImported:';

// One draft becomes the post at its own path, with the draft's text as that post's llm version. Idempotent: a
// second call finds the post and creates nothing. Works on a by-name draft too, which detaches it from the post it
// was feeding, because same path wins from then on.
export const importLlmDraft = (llmPath: string) =>
	chainSave(llmUserPath(llmPath), async () => {
		const { path, created } = await createUserVersion(llmPath);
		setMetaValue(`${llmImportedPrefix}${llmPath}`, new Date().toISOString());
		if (created) await ingestLlmFile(llmPath, getPostFilePath(llmPath), getStoredPost(path));
		return { path, created };
	});

const importLlmFiles = async (llmFiles: LlmFile[]) => {
	let imported = 0;
	for (const file of llmFiles) {
		try {
			if ((await importLlmDraft(file.path)).created) imported += 1;
		} catch {
			// unreadable draft stays standalone — retried next scan
		}
	}
	return imported;
};

// The first run only records the baseline: drafts already on disk wait for the bulk import.
const autoImportLlmDrafts = async (files: string[]) => {
	const since = getMetaValue(llmAutoImportSinceKey);
	if (!since) {
		setMetaValue(llmAutoImportSinceKey, String(Date.now()));
		return;
	}
	const standalone = standaloneLlmFiles(await listLlmFiles(files), listStoredPosts().map((post) => post.path));
	const imported = new Set(listMetaKeys(llmImportedPrefix).map((key) => key.slice(llmImportedPrefix.length)));
	await importLlmFiles(llmImportPlan(standalone, imported, Number(since)));
};

export const importAllLlmDrafts = async () => {
	await ensureCorpusImported();
	return withCheckoutReadLock(async () => {
		const files = await scanContentDir();
		const standalone = standaloneLlmFiles(await listLlmFiles(files), listStoredPosts().map((post) => post.path));
		return importLlmFiles(standalone);
	});
};

export const listLlmDrafts = async () => {
	await ensureCorpusImported();
	return withCheckoutReadLock(async () => {
		const files = await scanContentDir();
		const drafts = classifyLlmDrafts(await listLlmFiles(files), listStoredPosts().map((post) => post.path));
		return drafts.sort((first, second) => first.path.localeCompare(second.path));
	});
};

export const purgePost = (postPath: string) => withCheckoutLock(async () => {
	assertNoPendingPublishMutation('purging posts');
	let hadFile = true;
	try {
		await unlink(getPostFilePath(postPath));
	} catch (caught) {
		if (!(caught instanceof Error) || !('code' in caught) || caught.code !== 'ENOENT') throw caught;
		hadFile = false;
	}
	if (hadFile) {
		const commit = await commitPaths([getPostGitPath(postPath)], `cms: delete ${postPath}`);
		if (!commit.ok) throw new Error(`Purge commit failed: ${commit.output}`);
	}
	deletePostRows(postPath);
	return hadFile;
});
