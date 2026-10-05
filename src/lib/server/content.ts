import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat, unlink } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { formatYamlScalar, parseYamlScalar } from '$lib/frontmatter';
import { canonicalBody, hashPostContent, splitRawPost } from '$lib/post-text';
import { slugKey, slugify, svxSlug } from '$lib/svx';
import {
	appendRevision,
	deletePostRows,
	getEditingOrder,
	getStoredPost,
	listStoredPosts,
	seedEditingQueue,
	setExportedState,
	setLlmState,
	upsertVersion,
	type StoredPost
} from './db';
import { getDeployStatus, readDeployState, type DeployState, type DeployStatus } from './deploy-state';
import { ensureCorpusImported } from './import-corpus';
import { ensureSiteBaseRepaired, ensureSvxBaseline } from './import-svx';
import { contentBaseDirectory, contentDirectory } from './paths';
import { decideSave, normalizeNewlines, type SaveDecision } from '$lib/save-rules';

export { splitRawPost };

export type PostSummary = {
	path: string;
	title: string;
	date: string;
	tags: string[];
	publish: boolean;
	pin: boolean;
	editingOrder: number | null;
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
	const resolved = resolve(contentDirectory, postPath);

	if (resolved !== contentDirectory && !resolved.startsWith(`${contentDirectory}${sep}`)) {
		throw new Error('Post path must stay inside the content directory');
	}

	if (!isMarkdownFile(resolved)) {
		throw new Error('Post path must end in .md');
	}

	return resolved;
};

export const getPostGitPath = (postPath: string) => normalizePostPath(relative(contentBaseDirectory, getPostFilePath(postPath)));

const readFrontmatterValue = (frontmatter: string, key: string) => {
	const line = frontmatter.split(/\r?\n/).find((item) => item.match(new RegExp(`^${key}:\\s*`)));

	if (!line) return '';

	return parseYamlScalar(line.replace(new RegExp(`^${key}:\\s*`), ''));
};

const readBoolean = (frontmatter: string, key: string) => readFrontmatterValue(frontmatter, key) === 'true';

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

const postFromStored = (stored: StoredPost, deployState: DeployState, editingOrder: Map<string, number>): Post => {
	const { path, frontmatter, body } = stored;
	const fallbackTitle = path.replace(/\.md$/, '').split('/').at(-1)?.replaceAll('-', ' ') ?? 'Untitled';
	const publish = readBoolean(frontmatter, 'publish');
	const deleteRequested = readBoolean(frontmatter, 'delete') || readBoolean(frontmatter, 'deleted');
	const deployed = deployState.posts[path];

	return {
		path,
		title: readFrontmatterValue(frontmatter, 'title') || fallbackTitle,
		date: readFrontmatterValue(frontmatter, 'date'),
		tags: readTags(frontmatter),
		publish,
		pin: readBoolean(frontmatter, 'pin') || readBoolean(frontmatter, 'pinned'),
		editingOrder: editingOrder.get(path) ?? null,
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

const parseFilePost = async (
	filePath: string,
	deployState: DeployState,
	editingOrder: Map<string, number>
): Promise<Post> => {
	const raw = await readFile(filePath, 'utf8');
	const { frontmatter, body } = splitRawPost(raw);
	const metadata = await stat(filePath);
	const postPath = normalizePostPath(relative(contentDirectory, filePath));
	const fallbackTitle = postPath.replace(/\.md$/, '').split('/').at(-1)?.replaceAll('-', ' ') ?? 'Untitled';
	const contentHash = hashPostContent(frontmatter, body);
	const publish = readBoolean(frontmatter, 'publish');
	const deleteRequested = readBoolean(frontmatter, 'delete') || readBoolean(frontmatter, 'deleted');
	const deployed = deployState.posts[postPath];

	return {
		path: postPath,
		title: readFrontmatterValue(frontmatter, 'title') || fallbackTitle,
		date: readFrontmatterValue(frontmatter, 'date'),
		tags: readTags(frontmatter),
		publish,
		pin: readBoolean(frontmatter, 'pin') || readBoolean(frontmatter, 'pinned'),
		editingOrder: editingOrder.get(postPath) ?? null,
		deleteRequested,
		slug: svxSlug(postPath, frontmatter),
		excerpt: getExcerpt(body),
		updatedAt: metadata.mtime.toISOString(),
		contentHash,
		deployStatus: getDeployStatus({ publish, deleteRequested, contentHash }, deployed),
		deployedAt: deployed?.deployedAt,
		baselineCommit: deployed?.commit ?? null,
		frontmatter,
		body
	};
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
	if (stored.llmMtimeMs === meta.mtimeMs) return;

	const raw = normalizeNewlines(await readFile(filePath, 'utf8'));
	const { frontmatter, body } = splitRawPost(raw);
	const hash = hashPostContent(frontmatter, body);

	if (hash !== stored.llmHash) {
		upsertVersion({
			path: stored.path,
			writer: 'llm',
			sessionId: 'file',
			baseHash: stored.hash,
			frontmatter: frontmatter.trim(),
			body: canonicalBody(body)
		});
	}
	setLlmState(stored.path, hash, meta.mtimeMs);
};

const baseName = (postPath: string) => postPath.replace(/\.md$/, '').split('/').at(-1) ?? '';

// An llm draft belongs to the post at the same path, else to the one post anywhere whose name matches it.
const llmOwner = (llmPath: string, stored: StoredPost[]): StoredPost | null => {
	const samePath = llmPath.replace(/\.llm\.md$/, '.md');
	const exact = stored.filter((post) => post.path === samePath);
	if (exact.length) return exact[0];
	const key = slugKey(baseName(samePath));
	const byName = stored.filter((post) => slugKey(baseName(post.path)) === key);
	return byName.length === 1 ? byName[0] : null;
};

const scanContentDir = async (): Promise<string[]> => {
	const files = await listMarkdownFiles(contentDirectory);
	const storedList = listStoredPosts();
	const stored = new Map(storedList.map((post) => [post.path, post]));

	for (const filePath of files) {
		const postPath = normalizePostPath(relative(contentDirectory, filePath));
		try {
			if (postPath.endsWith('.llm.md')) {
				await ingestLlmFile(postPath, filePath, llmOwner(postPath, storedList));
			} else {
				await ingestUserFile(postPath, filePath, stored.get(postPath) ?? null);
			}
		} catch {
			// unreadable file must never block the post list — skipped this tick, retried next
		}
	}

	return files;
};

export const listPosts = async () => {
	await ensureCorpusImported();
	await ensureSvxBaseline();
	await ensureSiteBaseRepaired();
	const files = await scanContentDir();
	const deployState = await readDeployState();
	let order = getEditingOrder();
	let posts = listStoredPosts().map((stored) => postFromStored(stored, deployState, order));

	const storedList = listStoredPosts();
	const standaloneLlm = files.filter(
		(file) => file.endsWith('.llm.md') && !llmOwner(normalizePostPath(relative(contentDirectory, file)), storedList)
	);
	posts = posts.concat(await Promise.all(standaloneLlm.map((file) => parseFilePost(file, deployState, order))));

	const legacyEditPaths = posts.filter((post) => readBoolean(post.frontmatter, 'edit')).map((post) => post.path);
	if (seedEditingQueue(legacyEditPaths)) {
		order = getEditingOrder();
		posts = posts.map((post) => ({ ...post, editingOrder: order.get(post.path) ?? null }));
	}

	return posts.sort((first, second) => {
		const firstDate = first.date || first.updatedAt;
		const secondDate = second.date || second.updatedAt;
		return secondDate.localeCompare(firstDate);
	});
};

export const postsRev = (posts: PostSummary[]) =>
	createHash('sha256')
		.update(
			JSON.stringify(
				posts.map((post) => [
					post.path,
					post.contentHash,
					post.editingOrder,
					post.deployStatus,
					post.deleteRequested,
					post.pin
				])
			)
		)
		.digest('hex')
		.slice(0, 16);

export const getPost = async (postPath: string): Promise<Post> => {
	if (postPath.endsWith('.llm.md')) {
		return parseFilePost(getPostFilePath(postPath), await readDeployState(), getEditingOrder());
	}
	const stored = getStoredPost(postPath);
	if (!stored) throw new Error(`Unknown post: ${postPath}`);
	return postFromStored(stored, await readDeployState(), getEditingOrder());
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

export const createPost = async (title: string) => {
	const date = new Date().toISOString().slice(0, 10);
	const baseSlug = slugify(title);
	let postPath = `${baseSlug}.md`;
	let suffix = 2;

	while (getStoredPost(postPath) || existsSync(getPostFilePath(postPath))) {
		postPath = `${baseSlug}-${suffix}.md`;
		suffix += 1;
	}

	const frontmatter = `title: ${formatYamlScalar(title)}\ndate: ${date}\ntags: \npublish: false`;
	appendRevision(postPath, frontmatter, '', hashPostContent(frontmatter, ''), 'cms');
	return getPost(postPath);
};

export const createUserVersion = async (llmPath: string) => {
	if (!llmPath.endsWith('.llm.md')) throw new Error('Can only fork .llm.md drafts');
	const userPath = llmPath.replace(/\.llm\.md$/, '.md');
	if (getStoredPost(userPath)) return userPath;

	const raw = normalizeNewlines(await readFile(getPostFilePath(llmPath), 'utf8'));
	const frontmatter = splitRawPost(raw)
		.frontmatter.split('\n')
		.filter((line) => !line.match(/^publish:/))
		.join('\n')
		.trim();

	appendRevision(userPath, frontmatter, '', hashPostContent(frontmatter, ''), 'cms');
	return userPath;
};

export const purgePost = async (postPath: string) => {
	deletePostRows(postPath);
	try {
		await unlink(getPostFilePath(postPath));
		return true;
	} catch {
		return false;
	}
};
