import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock } from 'node:test';

const root = mkdtempSync(join(tmpdir(), 'cms-assistant-file-races-'));
mkdirSync(join(root, 'content'));
mkdirSync(join(root, '.data'));
mkdirSync(join(root, 'src/posts'), { recursive: true });
execFileSync('git', ['init', '-q', '-b', 'main', root]);
writeFileSync(join(root, 'src/posts/live.svx'), '---\ntitle: Live\npublished: true\n---\n\nPublished.\n');
process.env.BLOG_CONTENT_BASE_DIR = root;
process.env.BLOG_CMS_DB = join(root, 'cms.db');
process.chdir(root);

const { createPost, listPosts, savePost } = await import('./content.ts');
const { changeAssistantDraft, getAssistantDraft, getStoredPost, listVersions } = await import('./db.ts');

const create = async (title: string) => {
	const post = await createPost(`title: ${title}\npublish: false`, 'Human body.', 'mac');
	const file = join(root, 'content', post.path.replace(/\.md$/, '.llm.md'));
	writeFileSync(file, `---\ntitle: ${title}\n---\n\nInitial file.\n`);
	utimesSync(file, 2_000_000_000, 2_000_000_000);
	await listPosts();
	return { post, file };
};
const editFile = (file: string, body: string) => {
	writeFileSync(file, `---\ntitle: File suggestion\n---\n\n${body}\n`);
	utimesSync(file, 2_000_000_001, 2_000_000_001);
};
const editApi = (path: string, body: string) => {
	const current = getAssistantDraft(path)!;
	assert.equal(changeAssistantDraft(path, current.revision, (_draft, post) => ({
		frontmatter: current.frontmatter, baseHash: post.hash, body
	})).outcome, 'write');
};
const fileReference = (path: string) => listVersions(path).find((version) => version.writer === 'llm-file');

try {
	const fileOnly = await create('File only');
	const fileToken = getAssistantDraft(fileOnly.post.path)!.revision;
	editFile(fileOnly.file, 'File-only update.');
	await listPosts();
	assert.equal(getAssistantDraft(fileOnly.post.path)!.body, 'File-only update.');
	assert.notEqual(getAssistantDraft(fileOnly.post.path)!.revision, fileToken);
	assert.equal(getStoredPost(fileOnly.post.path)!.llmVersionRevision, getAssistantDraft(fileOnly.post.path)!.revision);
	assert.equal(listVersions(fileOnly.post.path).length, 1);
	editApi(fileOnly.post.path, 'File-only update.');
	editFile(fileOnly.file, 'File after identical API replacement.');
	await listPosts();
	assert.equal(getAssistantDraft(fileOnly.post.path)!.body, 'File-only update.');
	assert.equal(fileReference(fileOnly.post.path)?.body, 'File after identical API replacement.');

	const delayed = await create('Delayed scan');
	editFile(delayed.file, 'Older file edit.');
	editApi(delayed.post.path, 'Newer API edit.');
	await listPosts();
	assert.equal(getAssistantDraft(delayed.post.path)!.body, 'Newer API edit.', 'a scan starting after the API write cannot overwrite it');
	assert.equal(fileReference(delayed.post.path)?.body, 'Older file edit.', 'the unsynchronized file edit remains reviewable');
	const both = listVersions(delayed.post.path);
	await listPosts();
	assert.deepEqual(listVersions(delayed.post.path), both, 'unchanged file content does not churn either reference');

	const reverse = await create('Reverse race');
	utimesSync(reverse.file, 2_000_000_001, 2_000_000_001);
	const reading = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const originalReadFile = fsPromises.readFile;
	const readMock = mock.method(fsPromises, 'readFile', async (...args: Parameters<typeof fsPromises.readFile>) => {
		if (args[0] === reverse.file) {
			reading.resolve();
			await release.promise;
		}
		return originalReadFile(...args);
	});
	syncBuiltinESMExports();
	try {
		const scan = listPosts();
		await reading.promise;
		editApi(reverse.post.path, 'API while scan awaits.');
		editFile(reverse.file, 'Newer file while scan awaits.');
		release.resolve();
		await scan;
	} finally {
		release.resolve();
		readMock.mock.restore();
		syncBuiltinESMExports();
	}
	assert.equal(getAssistantDraft(reverse.post.path)!.body, 'API while scan awaits.');
	assert.equal(fileReference(reverse.post.path)?.body, 'Newer file while scan awaits.', 'a changed API token cannot discard newly read file text');
	await listPosts();
	assert.equal(fileReference(reverse.post.path)?.body, 'Newer file while scan awaits.');
	editFile(reverse.file, 'A subsequent file edit.');
	await listPosts();
	assert.equal(getAssistantDraft(reverse.post.path)!.body, 'API while scan awaits.');
	assert.equal(fileReference(reverse.post.path)?.body, 'A subsequent file edit.', 'same-mtime file edits remain visible');

	const humanRace = await create('Human base race');
	const started = Promise.withResolvers<void>();
	const finish = Promise.withResolvers<void>();
	const baseMock = mock.method(fsPromises, 'readFile', async (...args: Parameters<typeof fsPromises.readFile>) => {
		if (args[0] === humanRace.file) { started.resolve(); await finish.promise; }
		return originalReadFile(...args);
	});
	syncBuiltinESMExports();
	editFile(humanRace.file, 'File based on the latest human.');
	let currentHash = '';
	try {
		const scan = listPosts();
		await started.promise;
		const saved = await savePost(humanRace.post.path, humanRace.post.frontmatter, 'Updated human.', humanRace.post.contentHash, 'mac');
		currentHash = saved.post.contentHash;
		finish.resolve();
		await scan;
	} finally {
		finish.resolve();
		baseMock.mock.restore();
		syncBuiltinESMExports();
	}
	assert.equal(getAssistantDraft(humanRace.post.path)!.baseHash, currentHash, 'file import uses the human hash inside its transaction');
	assert.equal(getStoredPost(humanRace.post.path)!.body, 'Updated human.');
} finally {
	rmSync(root, { recursive: true, force: true });
}
