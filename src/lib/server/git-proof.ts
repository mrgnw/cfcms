import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertCheckoutWriteLock } from './checkout-lock';
import { runGit } from './git';

const commitPattern = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

export const verifyRewrittenCommit = async (pending: string, remote: string) => {
	assertCheckoutWriteLock();
	if (!commitPattern.test(pending) || !commitPattern.test(remote)) throw new Error('Invalid recovery commit');
	const objects = await runGit(['rev-parse', '--path-format=absolute', '--git-path', 'objects'], 10_000);
	const format = await runGit(['rev-parse', '--show-object-format'], 10_000);
	if (!objects.ok || !format.ok || !['sha1', 'sha256'].includes(format.output.trim())) {
		throw new Error('Cannot locate the captured Git objects for recovery');
	}
	const directory = await mkdtemp(join(tmpdir(), 'cms-commit-proof-'));
	const env: NodeJS.ProcessEnv = {
		...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
		GIT_CONFIG_NOSYSTEM: '1',
		GIT_CONFIG_GLOBAL: '/dev/null',
		GIT_ATTR_NOSYSTEM: '1',
		GIT_TERMINAL_PROMPT: '0',
		GIT_ALTERNATE_OBJECT_DIRECTORIES: JSON.stringify(objects.output.trim())
	};
	const git = (args: string[]) => runGit(args, 15_000, { cwd: directory, env, keepStart: true });
	try {
		const initialized = await git(['init', '-q', '--bare', '--template=', `--object-format=${format.output.trim()}`, '.']);
		if (!initialized.ok) throw new Error(`Cannot initialize isolated recovery: ${initialized.output}`);
		await mkdir(join(directory, 'info'), { recursive: true });
		await writeFile(join(directory, 'info/attributes'), '* merge=text -filter -text -working-tree-encoding\n');
		const base = await git(['merge-base', '--all', pending, remote]);
		if (!base.ok || !commitPattern.test(base.output.trim())) {
			throw new Error('The captured history is unavailable or has no unique common remote ancestor; restore and inspect its Git history before recovery');
		}
		const empty = await git(['mktree']);
		const remoteTree = await git(['rev-parse', `${remote}^{tree}`]);
		if (!empty.ok || !remoteTree.ok) throw new Error('Cannot read the remote publication tree');
		const merged = await git([
			`--attr-source=${empty.output.trim()}`, 'merge-tree', '--write-tree', '--no-messages',
			`--merge-base=${base.output.trim()}`, '-Xno-renames', remote, pending
		]);
		const tree = merged.output.split('\n', 1)[0].trim();
		if (![0, 1].includes(merged.status ?? -1) || !commitPattern.test(tree)) {
			throw new Error(`Cannot verify rewritten delivery with isolated Git merge-tree. Server Git must support merge-tree --merge-base and --attr-source; upgrade Git if either option is unavailable, then verify again: ${merged.output}`);
		}
		const differences = await git(['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', remote, tree]);
		if (!differences.ok) throw new Error('Cannot list unresolved publication paths');
		return {
			equivalent: merged.ok && tree === remoteTree.output.trim(),
			paths: differences.output.split('\0').filter(Boolean).slice(0, 50)
		};
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
};
