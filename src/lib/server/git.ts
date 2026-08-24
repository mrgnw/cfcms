import { spawn } from 'node:child_process';
import { getPostGitPath, splitRawPost } from './content';
import { hashPostContent } from './deploy-state';
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

const revisionWalkLimit = 50;
const baseContentCache = new Map<string, { frontmatter: string; body: string } | null>();
const baseContentCacheLimit = 200;

export const findRevisionByHash = async (postPath: string, wantedHash: string) => {
	const cacheKey = `${postPath}\n${wantedHash}`;
	const cached = baseContentCache.get(cacheKey);
	if (cached !== undefined) return cached;

	const gitPath = getPostGitPath(postPath);
	const log = await runGit(['log', `-n${revisionWalkLimit}`, '--format=%H', '--', gitPath]);
	let found: { frontmatter: string; body: string } | null = null;

	if (log.ok) {
		for (const revision of log.output.trim().split('\n').filter(Boolean)) {
			const show = await runGit(['show', `${revision}:${gitPath}`]);
			if (!show.ok || show.output.length >= outputLimit) continue;
			const split = splitRawPost(show.output);
			if (hashPostContent(split.frontmatter, split.body) === wantedHash) {
				found = split;
				break;
			}
		}
	}

	if (baseContentCache.size >= baseContentCacheLimit) baseContentCache.clear();
	baseContentCache.set(cacheKey, found);
	return found;
};

const compactMessage = (value: string) => value.replace(/\s+/g, ' ').trim().slice(0, 120);

export const commitPost = async (postPath: string, action: 'create' | 'save' | 'delete') => {
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

export const getHeadCommit = async () => {
	const result = await runGit(['rev-parse', 'HEAD']);
	return result.ok ? result.output.trim() : null;
};

export const diffNumstat = async (commit: string, postPath: string) => {
	const result = await runGit(['diff', '--numstat', commit, 'HEAD', '--', getPostGitPath(postPath)]);

	if (!result.ok) return null;

	const line = result.output.trim().split('\n').filter(Boolean).at(0);
	if (!line) return { added: 0, deleted: 0 };

	const [added, deleted] = line.split('\t');
	if (added === '-' || deleted === '-') return { added: 0, deleted: 0 };

	return { added: Number(added), deleted: Number(deleted) };
};
