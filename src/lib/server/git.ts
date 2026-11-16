import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertCheckoutWriteLock } from './checkout-lock';
import { contentBaseDirectory } from './paths';

type GitResult = {
	ok: boolean;
	status: number | null;
	output: string;
	truncated?: boolean;
	stderr?: string;
};

const outputLimit = 20_000;

type GitContext = {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	input?: string;
	keepStart?: boolean;
	outputLimit?: number;
	stdoutOnly?: boolean;
};

export const runGit = (args: string[], timeoutMs?: number, context: GitContext = {}): Promise<GitResult> =>
	new Promise((resolve) => {
		let output = Buffer.alloc(0);
		let stderr = '';
		let truncated = false;
		const limit = context.outputLimit ?? outputLimit;
		if (!Number.isInteger(limit) || limit < 1 || limit > 4 * 1024 * 1024) throw new RangeError('Invalid Git output bound');
		const child = spawn('git', args, {
			cwd: context.cwd ?? contentBaseDirectory,
			env: context.env ?? process.env,
			timeout: timeoutMs
		});

		const appendOutput = (chunk: Buffer) => {
			const combined = Buffer.concat([output, chunk]);
			if (combined.length > limit) truncated = true;
			output = context.keepStart ? combined.subarray(0, limit) : combined.subarray(-limit);
		};

		child.stdout.on('data', appendOutput);
		child.stderr.on('data', (chunk: Buffer) => {
			if (context.stdoutOnly) stderr = `${stderr}${chunk.toString()}`.slice(-2000);
			else appendOutput(chunk);
		});
		child.stdin.on('error', () => undefined);
		child.stdin.end(context.input ?? '');

		child.on('close', (status) => {
			const text = output.toString('utf8');
			resolve({
				ok: status === 0, status,
				output: child.killed ? `${text}\nGit command timed out.` : text,
				...(truncated ? { truncated: true } : {}),
				...(context.stdoutOnly ? { stderr } : {})
			});
		});

		child.on('error', (caught) => {
			resolve({ ok: false, status: null, output: caught.message });
		});
	});

const compactMessage = (value: string) => value.replace(/\s+/g, ' ').trim().slice(0, 120);

const dropVanishedPaths = async (paths: string[]) => {
	if (paths.length === 0) return paths;
	const tracked = await runGit(['ls-files', '-z', '--', ...paths]);
	if (!tracked.ok) throw new Error(`git ls-files failed: ${tracked.output}`);
	const trackedPaths = new Set(tracked.output.split('\0'));
	return paths.filter((path) => trackedPaths.has(path) || existsSync(resolve(contentBaseDirectory, path)));
};

export const commitPaths = async (requestedPaths: string[], message: string, beforeCommit?: (paths: string[]) => Promise<void>) => {
	assertCheckoutWriteLock();
	const paths = await dropVanishedPaths(requestedPaths);
	if (paths.length === 0) {
		await beforeCommit?.(paths);
		return { ok: true, status: 0, output: 'Nothing to commit', committed: false };
	}
	const add = await runGit(['add', '--', ...paths]);
	if (!add.ok) return { ...add, committed: false };
	await beforeCommit?.(paths);
	const diff = await runGit(['diff', '--cached', '--quiet', '--', ...paths]);
	if (diff.status === 0) return { ok: true, status: 0, output: 'No changes to commit', committed: false };
	const commit = await runGit(['commit', '-m', compactMessage(message), '--', ...paths]);
	return { ...commit, committed: commit.ok };
};

export const pushContent = async (commit?: string) => {
	assertCheckoutWriteLock();
	if (commit && !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(commit)) throw new Error('Invalid captured push commit');
	return runGit(['push', 'origin', commit ? `${commit}:refs/heads/main` : 'main'], 30_000);
};

export const retainPushCommit = async (kind: 'publication' | 'backup', commit: string) => {
	assertCheckoutWriteLock();
	if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(commit)) throw new Error('Invalid captured push commit');
	const retained = await runGit(['update-ref', `refs/cfcms/pending-${kind}`, commit], 10_000);
	if (!retained.ok) throw new Error(`Cannot retain the captured ${kind} for recovery: ${retained.output}`);
};

export const getHeadCommit = async () => {
	const result = await runGit(['rev-parse', 'HEAD']);
	return result.ok ? result.output.trim() : null;
};

export const getCurrentBranch = async () => {
	const result = await runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
	return result.ok ? result.output.trim() : null;
};
