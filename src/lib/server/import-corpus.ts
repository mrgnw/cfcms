import { existsSync } from 'node:fs';
import { readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { canonicalBody, hashPostContent, splitRawPost } from '$lib/post-text';
import { normalizeNewlines } from '$lib/save-rules';
import {
	appendRevision, deletePostRows, getMetaValue, getPublishedPosts, getStoredPost,
	listStoredPosts, setExportedState, setMetaValue, updatePublishedHash
} from './db';
import { commitPaths, runGit } from './git';
import { getPostFilePath, getPostGitPath, listContentFiles } from './content';
import { runBackup } from './backup';
import { contentDirectory } from './paths';

const demoPath = 'sync-demo.md';

const runImport = async () => {
	if (getMetaValue('importedCorpus')) return;

	const report: string[] = ['# Corpus import report', '', `Ran: ${new Date().toISOString()}`, ''];

	deletePostRows(demoPath);
	const demoRemoved = await unlink(getPostFilePath(demoPath)).then(() => true, () => false);
	const removedFiles: string[] = demoRemoved ? [demoPath] : [];

	const files = await listContentFiles();
	const markdown = files.filter((file) => file.endsWith('.md') && !file.endsWith('.llm.md'));
	let imported = 0;

	for (const filePath of markdown) {
		const postPath = relative(contentDirectory, filePath).replaceAll('\\', '/');
		if (postPath === demoPath || getStoredPost(postPath)) continue;
		const raw = normalizeNewlines(await readFile(filePath, 'utf8'));
		const { frontmatter, body } = splitRawPost(raw);
		const hash = hashPostContent(frontmatter, body);
		appendRevision(postPath, frontmatter.trim(), canonicalBody(body), hash, 'import');
		const meta = await stat(filePath);
		setExportedState(postPath, hash, meta.mtimeMs);
		imported += 1;
	}
	report.push(`Imported ${imported} posts as revision 1.`);

	const published = getPublishedPosts();
	const misses: string[] = [];
	const shifted: string[] = [];
	for (const [postPath, state] of Object.entries(published)) {
		if (!state.commit) { misses.push(`${postPath} (no published commit recorded)`); continue; }
		const shown = await runGit(['show', `${state.commit}:${getPostGitPath(postPath)}`]);
		if (!shown.ok) { misses.push(`${postPath} (git show failed)`); continue; }
		const split = splitRawPost(normalizeNewlines(shown.output));
		const newHash = hashPostContent(split.frontmatter, split.body);
		updatePublishedHash(postPath, newHash);
		const current = getStoredPost(postPath);
		if (current && current.hash !== newHash) shifted.push(postPath);
	}
	report.push(`Recomputed ${Object.keys(published).length - misses.length} published hashes.`);
	if (misses.length) report.push('', 'Could not recompute (status may read as changed):', ...misses.map((m) => `- ${m}`));
	if (shifted.length) report.push('', 'Deploy status now `changed` (head differs from published under the fixed parser):', ...shifted.map((p) => `- ${p}`));

	for (const filePath of markdown) {
		const postPath = relative(contentDirectory, filePath).replaceAll('\\', '/');
		if (postPath === demoPath) continue;
		if (!published[postPath]) {
			const removed = await unlink(filePath).then(() => true, () => false);
			if (removed) { removedFiles.push(postPath); setExportedState(postPath, null, null); }
		}
	}
	report.push('', `Deleted ${removedFiles.length} draft files (drafts live in the store now):`, ...removedFiles.map((p) => `- ${p}`));

	const commitCandidates = listStoredPosts()
		.map((post) => post.path)
		.filter((postPath) => !published[postPath] && !existsSync(getPostFilePath(postPath)));
	if (!existsSync(getPostFilePath(demoPath))) commitCandidates.push(demoPath);

	const gitPaths = commitCandidates.map((p) => getPostGitPath(p));
	const trackedSet = new Set<string>();
	if (gitPaths.length) {
		const tracked = await runGit(['ls-files', '--', ...gitPaths]);
		if (!tracked.ok) throw new Error(`Import ls-files failed: ${tracked.output}`);
		tracked.output.split('\n').filter(Boolean).forEach((p) => trackedSet.add(p));
	}
	const commitTargets = gitPaths.filter((p) => trackedSet.has(p));

	const commit = await commitPaths(commitTargets, 'cms: import corpus - drafts move to store');
	if (!commit.ok) throw new Error(`Import commit failed: ${commit.output}`);
	await writeFile(resolve(process.cwd(), '.data/import-report.md'), `${report.join('\n')}\n`, 'utf8');
	setMetaValue('importedCorpus', new Date().toISOString());
	await runBackup().catch(() => undefined);
};

let importPromise: Promise<void> | null = null;

export const ensureCorpusImported = () => {
	importPromise ??= runImport().catch((caught) => {
		importPromise = null;
		throw caught;
	});
	return importPromise;
};
