import { spawn } from 'node:child_process';
import { getPostGitPath } from './content';
import { contentBaseDirectory } from './paths';

type GitResult = {
	ok: boolean;
	status: number | null;
	output: string;
};

const outputLimit = 20_000;

const runGit = (args: string[]): Promise<GitResult> =>
	new Promise((resolve) => {
		let output = '';
		const child = spawn('git', args, {
			cwd: contentBaseDirectory,
			env: process.env
		});

		const appendOutput = (chunk: Buffer) => {
			output = `${output}${chunk.toString()}`.slice(-outputLimit);
		};

		child.stdout.on('data', appendOutput);
		child.stderr.on('data', appendOutput);

		child.on('close', (status) => {
			resolve({ ok: status === 0, status, output });
		});

		child.on('error', (caught) => {
			resolve({ ok: false, status: null, output: caught.message });
		});
	});

const compactMessage = (value: string) => value.replace(/\s+/g, ' ').trim().slice(0, 120);

export const commitPost = async (postPath: string, action: 'create' | 'save') => {
	const gitPath = getPostGitPath(postPath);
	const add = await runGit(['add', '--', gitPath]);

	if (!add.ok) return { ...add, committed: false, path: gitPath };

	const diff = await runGit(['diff', '--cached', '--quiet', '--', gitPath]);

	if (diff.status === 0) {
		return { ok: true, status: 0, output: 'No changes to commit', committed: false, path: gitPath };
	}

	const commit = await runGit(['commit', '-m', compactMessage(`cms: ${action} ${postPath}`), '--', gitPath]);
	return { ...commit, committed: commit.ok, path: gitPath };
};

export const pushContent = async () => runGit(['push']);
