import { env } from '$env/dynamic/private';
import { renderPost } from '$lib/post-text';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { runBackup } from './backup';
import { getPostFilePath, getPostGitPath, listPosts, type Post } from './content';
import { setExportedState } from './db';
import { recordPublishedState } from './deploy-state';
import { commitPaths, getHeadCommit, pushContent } from './git';

type PublishTarget = {
	name: string;
	cwd: string;
	command: string;
};

type PublishTargetResult = PublishTarget & {
	ok: boolean;
	status: number | null;
	durationMs: number;
	output: string;
};

const outputLimit = 20_000;

const getTargets = () =>
	[
		{
			name: 'svelte',
			cwd: env.SVELTE_BLOG_DIR ?? '~/dev/blog-loke',
			command: env.SVELTE_BLOG_DEPLOY_COMMAND ?? 'bun run build && bunx wrangler deploy'
		},
		{
			name: 'astro',
			cwd: env.ASTRO_BLOG_DIR ?? '~/dev/blog-astro',
			command: env.ASTRO_BLOG_DEPLOY_COMMAND ?? 'pnpm build && pnpm deploy'
		}
	].filter((target) => existsSync(target.cwd));

const runTarget = (target: PublishTarget): Promise<PublishTargetResult> =>
	new Promise((resolveResult) => {
		const startedAt = Date.now();
		let output = '';
		const child = spawn(target.command, {
			cwd: target.cwd,
			env: process.env,
			shell: true
		});

		const appendOutput = (chunk: Buffer) => {
			output = `${output}${chunk.toString()}`.slice(-outputLimit);
		};

		child.stdout.on('data', appendOutput);
		child.stderr.on('data', appendOutput);

		child.on('close', (status) => {
			resolveResult({
				...target,
				ok: status === 0,
				status,
				durationMs: Date.now() - startedAt,
				output
			});
		});

		child.on('error', (caught) => {
			resolveResult({
				...target,
				ok: false,
				status: null,
				durationMs: Date.now() - startedAt,
				output: caught.message
			});
		});
	});

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

export const runPublish = async () => {
	const targets = getTargets();

	if (targets.length === 0) {
		throw new Error('No publish targets configured');
	}

	const posts = await listPosts();
	const pendingPosts = posts.filter((post) =>
		['ready', 'changed', 'unpublish', 'delete'].includes(post.deployStatus)
	);

	const { gitPaths, exports } = await renderBoundary(posts);
	const commit = await commitPaths(gitPaths, 'cms: publish');
	if (!commit.ok) throw new Error(`Publish commit failed: ${commit.output}`);
	for (const exported of exports) setExportedState(exported.path, exported.hash, exported.mtimeMs);

	const [push, results] = await Promise.all([pushContent(), Promise.all(targets.map(runTarget))]);
	const ok = results.every((result) => result.ok);
	let deployment = null;
	if (ok) {
		deployment = await recordPublishedState(posts, await getHeadCommit());
		runBackup().catch(() => undefined);
	}

	return {
		ok,
		readyCount: pendingPosts.length,
		liveCount: posts.filter((post) => post.deployStatus === 'live').length,
		lastPublishedAt: deployment?.lastPublishedAt ?? null,
		runAt: new Date().toISOString(),
		push,
		results
	};
};
