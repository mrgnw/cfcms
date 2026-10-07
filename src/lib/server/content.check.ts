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

const { createPost, getPost, listPosts, purgePost, savePost } = await import('./content.ts');
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

	console.log('content.check: ok');
} finally {
	rmSync(root, { recursive: true, force: true });
}
