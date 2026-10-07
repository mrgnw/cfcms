// node --import ./scripts/check-hooks.ts src/lib/server/content.check.ts
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

const { createPost, getPost, importLlmDraft, listLlmDrafts, listPosts, purgePost, savePost } = await import('./content.ts');
const { listVersions, upsertVersion, getStoredPost } = await import('./db.ts');
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

	console.log('content.check: ok');
} finally {
	rmSync(root, { recursive: true, force: true });
}
