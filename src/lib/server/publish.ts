import { BLOG_BUILD_COMMAND } from '$app/env/private';
import { mainBranchError } from '#lib/branch.js';
import { renderPost } from '#lib/post-text.js';
import { parseFrontmatter } from '#lib/frontmatter.js';
import { renderSvx, svxSlug } from '#lib/svx.js';
import { isPending, statusOf } from '#lib/types.js';
import { spawn } from 'node:child_process';
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { runBackup } from './backup';
import { getPostFilePath, getPostGitPath, listPosts, type Post } from './content';
import { clearStaged, getPublishedPosts, getRevisionByHash, getStagedPaths, setExportedState } from './db';
import { recordPublishedState } from './deploy-state';
import { commitPaths, getCurrentBranch, getHeadCommit, pushContent, runGit } from './git';
import { contentBaseDirectory, svxDirectory } from './paths';
import { syncSiteText } from './site-text';

const svxGitDirectory = 'src/posts';
// The blog build vendors icons used by posts here on first use (remark-icons.js in the blog repo).
const iconGitDirectory = 'src/lib/icons';

type CommandResult = {
	name: string;
	ok: boolean;
	status: number | null;
	durationMs: number;
	output: string;
};

const outputLimit = 20_000;

const runCommand = (name: string, command: string, cwd: string): Promise<CommandResult> =>
	new Promise((resolveResult) => {
		const startedAt = Date.now();
		let output = '';
		const child = spawn(command, { cwd, env: process.env, shell: true });

		const appendOutput = (chunk: Buffer) => {
			output = `${output}${chunk.toString()}`.slice(-outputLimit);
		};

		child.stdout.on('data', appendOutput);
		child.stderr.on('data', appendOutput);

	child.on('close', (status) => {
		resolveResult({
			name,
			ok: status === 0,
			status,
			durationMs: Date.now() - startedAt,
			output
		});
	});

	child.on('error', (caught) => {
		resolveResult({
			name,
			ok: false,
			status: null,
			durationMs: Date.now() - startedAt,
			output: caught.message
		});
	});
});

export type LiveEntry = {
	path: string;
	slug: string;
	title: string;
	frontmatter: string;
	body: string;
	contentHash: string;
};

const headEntry = (post: Post): LiveEntry => ({
	path: post.path,
	slug: post.slug,
	title: post.title,
	frontmatter: post.frontmatter,
	body: post.body,
	contentHash: post.contentHash
});

const publishedEntry = (post: Post, publishedHash: string): LiveEntry => {
	const revision = getRevisionByHash(post.path, publishedHash);
	if (!revision) throw new Error(`Published revision missing for ${post.path}; unstaged post cannot be re-rendered`);
	return {
		path: post.path,
		slug: svxSlug(post.path, revision.frontmatter),
		title: parseFrontmatter(revision.frontmatter).title,
		frontmatter: revision.frontmatter,
		body: revision.body,
		contentHash: publishedHash
	};
};

export const buildLiveSet = (
	posts: Post[],
	published: Record<string, { hash: string }>,
	staged: Set<string>
): LiveEntry[] => {
	const entries: LiveEntry[] = [];
	for (const post of posts) {
		const status = statusOf(post);
		const isStaged = staged.has(post.path);
		if (isStaged && (status === 'ready' || status === 'changed')) entries.push(headEntry(post));
		else if (isStaged && (status === 'unpublish' || status === 'delete')) continue;
		else if (published[post.path]) entries.push(publishedEntry(post, published[post.path].hash));
	}

	const bySlug = new Map<string, string>();
	for (const entry of entries) {
		const other = bySlug.get(entry.slug);
		if (other) throw new Error(`Slug ${entry.slug} is used by both ${other} and ${entry.path}`);
		bySlug.set(entry.slug, entry.path);
	}
	return entries;
};

const renderSvxDirectory = async (entries: LiveEntry[]) => {
	await mkdir(svxDirectory, { recursive: true });
	const wanted = new Set(entries.map((entry) => `${entry.slug}.svx`));
	for (const name of await readdir(svxDirectory)) {
		if (name.endsWith('.svx') && !wanted.has(name)) await unlink(resolve(svxDirectory, name));
	}
	for (const entry of entries) {
		await writeFile(resolve(svxDirectory, `${entry.slug}.svx`), renderSvx(entry.frontmatter, entry.body), 'utf8');
	}
};

type PendingExport = { path: string; hash: string | null; mtimeMs: number | null };

const renderBoundary = async (posts: Post[]) => {
	const gitPaths: string[] = [];
	const exports: PendingExport[] = [];

	for (const post of posts) {
		const filePath = getPostFilePath(post.path);
		if (post.deployStatus === 'ready' || post.deployStatus === 'changed') {
			await mkdir(dirname(filePath), { recursive: true });
			await writeFile(filePath, renderPost(post.frontmatter, post.body), 'utf8');
			const meta = await stat(filePath);
			exports.push({ path: post.path, hash: post.contentHash, mtimeMs: meta.mtimeMs });
			gitPaths.push(getPostGitPath(post.path));
		} else if (post.deployStatus === 'delete' || post.deployStatus === 'unpublish') {
			await unlink(filePath).catch(() => undefined);
			exports.push({ path: post.path, hash: null, mtimeMs: null });
			gitPaths.push(getPostGitPath(post.path));
		}
	}

	return { gitPaths, exports };
};

const restoreWorkingTree = async (gitPaths: string[]) => {
	await runGit(['checkout', '--', svxGitDirectory, ...gitPaths]);
	await runGit(['clean', '-fd', '--', svxGitDirectory]);
};

export const runPublish = async () => {
	const branchError = mainBranchError(await getCurrentBranch());
	if (branchError) throw new Error(branchError);

	await syncSiteText();
	const posts = await listPosts();
	const published = getPublishedPosts();
	const staged = getStagedPaths();
	const going = posts.filter((post) => isPending(statusOf(post)) && staged.has(post.path));
	if (going.length === 0) throw new Error('Nothing staged for publish');

	const liveSet = buildLiveSet(posts, published, staged);
	await renderSvxDirectory(liveSet);

	const { gitPaths, exports } = await renderBoundary(going);
	const build = await runCommand('build', BLOG_BUILD_COMMAND ?? 'pnpm build', contentBaseDirectory);
	const runAt = new Date().toISOString();
	if (!build.ok) {
		await restoreWorkingTree(gitPaths);
		return {
			ok: false,
			stagedCount: going.length,
			liveCount: liveSet.length,
			lastPublishedAt: null,
			runAt,
			push: { ok: false, status: null, output: 'skipped: build failed' },
			results: [build]
		};
	}

	const commit = await commitPaths([svxGitDirectory, iconGitDirectory, ...gitPaths], 'cms: publish');
	if (!commit.ok) {
		await restoreWorkingTree(gitPaths);
		throw new Error(`Publish commit failed: ${commit.output}`);
	}
	for (const exported of exports) setExportedState(exported.path, exported.hash, exported.mtimeMs);
	// The commit is what any later push deploys, so the recorded state follows the commit, not the push.
	const deployment = await recordPublishedState(liveSet, await getHeadCommit());
	clearStaged(going.map((post) => post.path));

	const push = await pushContent();
	if (push.ok) runBackup().catch(() => undefined);

	return {
		ok: push.ok,
		stagedCount: going.length,
		liveCount: liveSet.length,
		lastPublishedAt: deployment.lastPublishedAt,
		runAt,
		push: push.ok ? push : { ...push, output: `Committed but not pushed; publish again to retry the push.\n${push.output}` },
		results: [build]
	};
};
