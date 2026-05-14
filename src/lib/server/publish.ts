import { env } from '$env/dynamic/private';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { listPosts } from './content';
import { pushContent } from './git';

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
			cwd: env.SVELTE_BLOG_DIR ?? env.BLOG_CONTENT_BASE_DIR ?? resolve(process.cwd(), '..', '..'),
			command: env.SVELTE_BLOG_DEPLOY_COMMAND ?? 'bun run build && bunx wrangler deploy'
		},
		{
			name: 'astro',
			cwd: env.ASTRO_BLOG_DIR ?? '~/dev/emm',
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

export const runPublish = async () => {
	const targets = getTargets();

	if (targets.length === 0) {
		throw new Error('No publish targets configured');
	}

	const posts = await listPosts();
	const readyPosts = posts.filter((post) => post.publish);
	const push = await pushContent();

	if (!push.ok) {
		return {
			ok: false,
			readyCount: readyPosts.length,
			runAt: new Date().toISOString(),
			push,
			results: []
		};
	}

	const results = await Promise.all(targets.map(runTarget));
	const ok = results.every((result) => result.ok);

	return {
		ok,
		readyCount: readyPosts.length,
		runAt: new Date().toISOString(),
		push,
		results
	};
};
