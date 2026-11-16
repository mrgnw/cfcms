import { cp, lstat, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { runGit } from './git';
import { contentBaseDirectory } from './paths';

export const snapshotPublishTree = async (paths: string[]) => {
	const index = await runGit(['rev-parse', '--git-path', 'index']);
	if (!index.ok) throw new Error(`Cannot locate Git index: ${index.output}`);
	const directory = await mkdtemp(join(tmpdir(), 'cms-publish-snapshot-'));
	const files: { target: string; backup: string; existed: boolean }[] = [];
	const discard = () => rm(directory, { recursive: true, force: true });
	try {
		for (const path of [...paths, index.output.trim()]) {
			const target = resolve(contentBaseDirectory, path);
			const backup = join(directory, String(files.length));
			const meta = await lstat(target).catch((caught: NodeJS.ErrnoException) => {
				if (caught.code !== 'ENOENT') throw caught;
				return null;
			});
			if (meta) await cp(target, backup, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
			files.push({ target, backup, existed: meta !== null });
		}
	} catch (caught) {
		await discard();
		throw caught;
	}
	return {
		discard,
		restore: async () => {
			try {
				for (const file of files) {
					await rm(file.target, { recursive: true, force: true });
					if (!file.existed) continue;
					await mkdir(dirname(file.target), { recursive: true });
					await cp(file.backup, file.target, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
				}
			} catch (caught) {
				throw new Error(`Publish rollback failed; recovery files retained at ${directory}`, { cause: caught });
			}
		}
	};
};
