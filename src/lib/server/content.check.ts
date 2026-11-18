// node --import ./scripts/check-hooks.ts src/lib/server/content.check.ts
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { mock } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'cms-check-'));
mkdirSync(join(root, 'content'));
mkdirSync(join(root, '.data'));
mkdirSync(join(root, 'src/posts'), { recursive: true });
execFileSync('git', ['init', '-q', '-b', 'main', root]);
// the startup import refuses a blog with no published posts
writeFileSync(
	join(root, 'src/posts/live-post.svx'),
	'---\ntitle: Live Post\ndate: 2026-01-01\npublished: true\n---\n\nAlready on the site.\n'
);
process.env.BLOG_CONTENT_BASE_DIR = root;
process.env.BLOG_CMS_DB = join(root, 'cms.db');
// import reports land in cwd/.data, not next to BLOG_CMS_DB
process.chdir(root);

const { createPost, getPost, getPostFilePath, importAllLlmDrafts, importLlmDraft, listLlmDrafts, listPosts, postsRev, purgePost, savePost } =
	await import('./content.ts');
const { changeAssistantDraft, getAssistantDraft, listVersions, upsertVersion, getStoredPost } = await import('./db.ts');
const { setDeleteFlag } = await import('../frontmatter.ts');

try {
	const draftFm = (title: string) => `title: ${title}\ndate: 2026-01-01\ntags: []\npublish: false`;
	const created = await createPost(draftFm('Hello World'), '', 'mac');
	assert.equal(created.path, 'hello-world.md');
	assert.equal(created.slug, 'hello-world');
	assert.equal((await createPost(draftFm('Hello World'), '', 'mac')).path, 'hello-world-2.md', 'a second post with the same title gets its own path');
	assert.equal((await createPost(draftFm(''), 'just a body', 'mac')).path, 'untitled.md', 'a post without a title still gets a path');
	await purgePost('untitled.md');
	assert.deepEqual((await listPosts()).map((post) => post.path).sort(), ['hello-world-2.md', 'hello-world.md', 'live-post.md']);

	const saved = await savePost(created.path, created.frontmatter, 'first draft', created.contentHash, 'mac');
	assert.equal(saved.outcome, 'write');
	assert.equal(saved.post.body, 'first draft');

	const retry = await savePost(created.path, created.frontmatter, 'first draft', created.contentHash, 'mac');
	assert.equal(retry.outcome, 'noop', 'a retried save from the old base that matches the head is not a conflict');

	// another device saves from the old base: main text must not move, and the edit must survive as a version
	const stale = await savePost(created.path, created.frontmatter, 'phone edit', created.contentHash, 'ph');
	assert.equal(stale.outcome, 'conflict');
	assert.equal((await getPost(created.path)).body, 'first draft');
	upsertVersion({
		path: created.path,
		writer: 'ph',
		sessionId: 'phone1',
		baseHash: created.contentHash,
		frontmatter: created.frontmatter,
		body: 'phone edit'
	});
	assert.deepEqual(
		listVersions(created.path).map((version) => [version.writer, version.body]),
		[['ph', 'phone edit']]
	);

	const head = await getPost(created.path);
	const trashed = await savePost(created.path, setDeleteFlag(head.frontmatter, true), head.body, head.contentHash, 'cms');
	assert.equal(trashed.outcome, 'write');
	assert.equal(trashed.post.deleteRequested, true);
	const restored = await savePost(
		created.path,
		setDeleteFlag(trashed.post.frontmatter, false),
		trashed.post.body,
		trashed.post.contentHash,
		'cms'
	);
	assert.equal(restored.post.deleteRequested, false);
	assert.equal(restored.post.body, 'first draft', 'trash and restore keep the body');

	await purgePost(created.path);
	assert.equal(getStoredPost(created.path), null);
	assert.deepEqual(listVersions(created.path), []);
	assert.equal(existsSync(join(root, 'content', created.path)), false);
	assert.deepEqual(
		(await listPosts()).map((post) => post.path).sort(),
		['hello-world-2.md', 'live-post.md'],
		'purge removes only that post'
	);

	// a standalone .llm.md: its route (or the admin page) imports it once, and a second import changes nothing
	writeFileSync(join(root, 'content', 'idea.llm.md'), '---\ntitle: Idea\ndate: 2026-02-02\n---\n\nThe draft text.\n');
	assert.deepEqual(
		(await listLlmDrafts()).map((draft) => [draft.path, draft.owner, draft.relation]),
		[['idea.llm.md', null, 'standalone']],
		'before import the draft is standalone'
	);
	const first = await importLlmDraft('idea.llm.md');
	assert.deepEqual(first, { path: 'idea.md', created: true });
	assert.equal((await getPost('idea.md')).body, '', 'the import never fills the body with llm text');
	assert.deepEqual(
		listVersions('idea.md').map((version) => [version.writer, version.body]),
		[['llm', 'The draft text.']],
		'the draft text is the llm version'
	);
	const second = await importLlmDraft('idea.llm.md');
	assert.deepEqual(second, { path: 'idea.md', created: false }, 'a second import finds the post');
	assert.equal(listVersions('idea.md').length, 1, 'and adds no version');
	assert.deepEqual(
		(await listLlmDrafts()).map((draft) => [draft.owner, draft.relation]),
		[['idea.md', 'same-path']],
		'after import the draft feeds its own post'
	);
	assert.equal(
		(await listPosts()).filter((post) => post.path.endsWith('.llm.md')).length,
		0,
		'an imported draft no longer shows as its own entry'
	);
	await purgePost('idea.md');

	const racePost = await createPost(draftFm('Race case'), 'Human stays here.', 'mac');
	const llmFile = join(root, 'content/race-case.llm.md');
	writeFileSync(llmFile, '---\ntitle: Race case\n---\n\nInitial file suggestion.\n');
	utimesSync(llmFile, 2_000_000_001, 2_000_000_001);
	await listPosts();
	const initialDraft = getAssistantDraft(racePost.path)!;
	writeFileSync(llmFile, '---\ntitle: Race case\n---\n\nDelayed file suggestion.\n');
	utimesSync(llmFile, 2_000_000_002, 2_000_000_002);
	const started = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const originalReadFile = fsPromises.readFile;
	const readMock = mock.method(fsPromises, 'readFile', async (...args: Parameters<typeof fsPromises.readFile>) => {
		if (args[0] === llmFile) {
			started.resolve();
			await release.promise;
		}
		return originalReadFile(...args);
	});
	syncBuiltinESMExports();
	try {
		const scanning = listPosts();
		await started.promise;
		assert.equal(changeAssistantDraft(racePost.path, initialDraft.revision, () => ({
			baseHash: racePost.contentHash, frontmatter: racePost.frontmatter, body: 'New API suggestion.'
		})).outcome, 'write');
		release.resolve();
		await scanning;
	} finally {
		release.resolve();
		readMock.mock.restore();
		syncBuiltinESMExports();
	}
	assert.equal(getAssistantDraft(racePost.path)!.body, 'New API suggestion.', 'a delayed file scan cannot overwrite an API update');
	assert.equal(listVersions(racePost.path).find((version) => version.writer === 'llm-file')?.body, 'Delayed file suggestion.');
	await listPosts();
	assert.equal(getAssistantDraft(racePost.path)!.body, 'New API suggestion.', 'the next scan cannot replay the delayed file');
	writeFileSync(llmFile, '---\ntitle: Race case\n---\n\nA later file edit.\n');
	utimesSync(llmFile, 2_000_000_003, 2_000_000_003);
	const beforeFileEdit = getAssistantDraft(racePost.path)!;
	await listPosts();
	assert.equal(getAssistantDraft(racePost.path)!.body, 'New API suggestion.');
	assert.equal(getAssistantDraft(racePost.path)!.revision, beforeFileEdit.revision);
	assert.equal(listVersions(racePost.path).find((version) => version.writer === 'llm-file')?.body, 'A later file edit.');
	assert.equal(getStoredPost(racePost.path)!.body, racePost.body);

	for (const bad of ['../outside.md', 'a/../../outside.md', '../content-evil/x.md', join(root, 'outside.md'), join(root, 'content', 'inside.md'), 'notes.txt', 'notes.md.txt', 'notes']) {
		assert.throws(() => getPostFilePath(bad), `getPostFilePath must reject ${bad}`);
	}
	assert.equal(getPostFilePath('sub/ok.md').endsWith(join('content', 'sub', 'ok.md')), true, 'a nested .md inside content is allowed');

	const editedFile = join(root, 'content', 'edited.md');
	const editedPost = (text: string) => `---\n${draftFm('Edited on disk')}\n---\n\n${text}\n`;
	writeFileSync(editedFile, editedPost('Original text.'));
	utimesSync(editedFile, 2_100_000_000, 2_100_000_000);
	await listPosts();
	const exported = getStoredPost('edited.md')!;
	assert.equal(exported.exportedHash, exported.hash, 'the first scan records the file as exported');
	assert.deepEqual(listVersions('edited.md'), [], 'an unedited file adds no version');

	writeFileSync(editedFile, editedPost('Original text.'));
	utimesSync(editedFile, 2_100_000_001, 2_100_000_001);
	await listPosts();
	assert.deepEqual(listVersions('edited.md'), [], 'touching a file without changing its text adds no version');

	writeFileSync(editedFile, editedPost('Disk text.'));
	utimesSync(editedFile, 2_100_000_002, 2_100_000_002);
	await listPosts();
	assert.deepEqual(
		listVersions('edited.md').map((version) => [version.writer, version.body, version.baseHash]),
		[['ext', 'Disk text.', exported.hash]],
		'an edit to an exported file becomes an ext version based on the export'
	);
	assert.equal((await getPost('edited.md')).body, 'Original text.', 'the ext edit does not move the head');

	const newFile = join(root, 'content', 'from-disk.md');
	writeFileSync(newFile, `---\n${draftFm('From disk')}\n---\n\nNew on disk.\n`);
	assert.equal(getStoredPost('from-disk.md'), null);
	assert.equal((await listPosts()).some((post) => post.path === 'from-disk.md'), true, 'a new file is listed');
	assert.equal(getStoredPost('from-disk.md')!.body, 'New on disk.', 'and imported as a post');

	const llmPost = await createPost(draftFm('Llm case'), 'Human text.', 'mac');
	const llmCaseFile = join(root, 'content/llm-case.llm.md');
	writeFileSync(llmCaseFile, '---\ntitle: Llm case\n---\n\nFirst suggestion.\n');
	utimesSync(llmCaseFile, 2_100_000_002, 2_100_000_002);
	await listPosts();
	assert.deepEqual(
		listVersions(llmPost.path).map((version) => [version.writer, version.body]),
		[['llm', 'First suggestion.']],
		'a new .llm.md becomes an llm version'
	);
	writeFileSync(llmCaseFile, '---\ntitle: Llm case\n---\n\nSecond suggestion.\n');
	utimesSync(llmCaseFile, 2_100_000_003, 2_100_000_003);
	await listPosts();
	assert.deepEqual(
		listVersions(llmPost.path).map((version) => [version.writer, version.body]),
		[['llm', 'Second suggestion.']],
		'a changed .llm.md replaces the llm version'
	);
	assert.equal(getStoredPost(llmPost.path)!.body, 'Human text.', 'the llm file never changes the post body');

	unlinkSync(join(root, 'content', 'idea.llm.md'));
	for (const name of ['bulk-a', 'bulk-b']) {
		writeFileSync(join(root, 'content', `${name}.llm.md`), `---\ntitle: ${name}\n---\n\n${name} text.\n`);
	}
	assert.equal(await importAllLlmDrafts(), 2, 'the bulk import creates one post per standalone draft');
	const bulkVersions = ['bulk-a.md', 'bulk-b.md'].map((path) => listVersions(path));
	assert.deepEqual(bulkVersions.map((versions) => versions.map((version) => version.writer)), [['llm'], ['llm']]);
	assert.equal(await importAllLlmDrafts(), 0, 'a second bulk import creates nothing');
	assert.deepEqual(['bulk-a.md', 'bulk-b.md'].map((path) => listVersions(path)), bulkVersions, 'and changes no version');

	const stableRev = postsRev(await listPosts());
	assert.equal(postsRev(await listPosts()), stableRev, 'postsRev is stable when nothing changed');
	const revPost = await getPost('edited.md');
	await savePost(revPost.path, revPost.frontmatter, 'App text, saved again.', revPost.contentHash, 'mac');
	assert.notEqual(postsRev(await listPosts()), stableRev, 'postsRev changes after a save');
	const listed = await listPosts();
	const rehashed = listed.map((post, index) => (index === 0 ? { ...post, contentHash: `${post.contentHash}x` } : post));
	assert.notEqual(postsRev(rehashed), postsRev(listed), 'postsRev depends on each post content hash');

	console.log('content.check: ok');
} finally {
	rmSync(root, { recursive: true, force: true });
}
