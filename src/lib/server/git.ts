import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertCheckoutWriteLock } from './checkout-lock';
import { contentBaseDirectory } from './paths';

type GitResult = {
	ok: boolean;
	status: number | null;
	output: string;
};

const outputLimit = 20_000;

export const runGit = (args: string[], timeoutMs?: number): Promise<GitResult> =>
	new Promise((resolve) => {
		let output = '';
		const child = spawn('git', args, {
			cwd: contentBaseDirectory,
			env: process.env,
			timeout: timeoutMs
		});

		const appendOutput = (chunk: Buffer) => {
			output = `${output}${chunk.toString()}`.slice(-outputLimit);
		};

		child.stdout.on('data', appendOutput);
		child.stderr.on('data', appendOutput);

		child.on('close', (status) => {
			resolve({ ok: status === 0, status, output: child.killed ? `${output}\nGit command timed out.` : output });
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

export const commitPaths = async (requestedPaths: string[], message: string) => {
	assertCheckoutWriteLock();
	const paths = await dropVanishedPaths(requestedPaths);
	if (paths.length === 0) return { ok: true, status: 0, output: 'Nothing to commit', committed: false };
	const add = await runGit(['add', '--', ...paths]);
	if (!add.ok) return { ...add, committed: false };
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

export const getHeadCommit = async () => {
	const result = await runGit(['rev-parse', 'HEAD']);
	return result.ok ? result.output.trim() : null;
};

export const getCurrentBranch = async () => {
	const result = await runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
	return result.ok ? result.output.trim() : null;
};
