import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hashPostContent } from '../../../lib/post-text.ts';

const root = mkdtempSync(join(tmpdir(), 'cms-inventory-check-'));
const databasePath = join(root, 'store', 'cms.db');
process.env.BLOG_CMS_DB = databasePath;
process.env.BLOG_CONTENT_BASE_DIR = root;

let allowStoreSetup = false;
const hooks = registerHooks({
	resolve(specifier, context, nextResolve) {
		const resolved = nextResolve(specifier, context);
		if (!allowStoreSetup && /\/server\/(db|content|backup|git|import-[^/]+)\.ts$/.test(resolved.url)) {
			throw new Error(`Inventory loaded a mutating dependency: ${resolved.url}`);
		}
		return resolved;
	}
});

const { GET: list } = await import('./+server.ts');
const { GET: detail } = await import('./[id]/+server.ts');
const get = (query = '') => list({ url: new URL(`http://cms.test/api/inventory${query}`) } as never);
const post = (id: string) => detail({ params: { id } } as never);
const rejects = (request: Promise<Response>, status: number) =>
	assert.rejects(request, (caught: { status: number }) => caught.status === status);

type Version = {
	writer: string;
	sessionId: string;
	baseHash: string;
	updatedAt: string;
	contentHash?: string;
	frontmatter?: string;
	body?: string;
};
type Post = {
	id: string;
	path: string;
	title: string;
	slug: string;
	deployStatus: string;
	head: { rev: number; contentHash: string; writer: string; savedAt: string; body?: string };
	versions: Version[];
	hasVersions: boolean;
	oversized: { frontmatter: boolean; versions: boolean; metadata: boolean };
	staged: boolean;
	editingOrder: number | null;
};
type Page = { posts: Post[]; nextCursor: string | null };
const page = async (query = '') => (await (await get(query)).json()) as Page;
const data = async (id: string) => (await (await post(id)).json()) as Post;

const snapshotFiles = () => readdirSync(root, { recursive: true, withFileTypes: true })
	.filter((entry) => entry.isFile() && !entry.name.endsWith('-shm'))
	.map((entry) => join(entry.parentPath, entry.name))
	.sort()
	.map((path) => [path, readFileSync(path).toString('hex')]);

let fixture: DatabaseSync | undefined;
try {
	await rejects(get(), 503);
	await rejects(post('not-a-post-id'), 400);
	assert.deepEqual(readdirSync(root), [], 'a missing store does not create its parent directory');
	for (const query of ['limit=0', 'limit=-1', 'limit=101', 'limit=1.5', 'limit=1e2', 'limit=', 'limit=Infinity',
		'limit=01', 'after=', 'after=../../secret', 'after=%27%20OR%201=1--', 'after=abcdefg']) {
		await rejects(get(`?${query}`), 400);
	}

	mkdirSync(join(root, 'store'));
	const legacy = new DatabaseSync(databasePath);
	legacy.exec('CREATE TABLE posts (path TEXT PRIMARY KEY)');
	legacy.close();
	const legacyFiles = snapshotFiles();
	await rejects(get(), 503);
	await rejects(post('aaaaaa'), 503);
	assert.deepEqual(snapshotFiles(), legacyFiles, 'legacy schema is not migrated or backfilled');
	rmSync(databasePath);

	allowStoreSetup = true;
	const store = await import('../../../lib/server/db.ts');
	store.getPublishedPosts();
	allowStoreSetup = false;
	assert.deepEqual(await page(), { posts: [], nextCursor: null });
	fixture = new DatabaseSync(databasePath);
	const setId = fixture.prepare('UPDATE posts SET id = ? WHERE path = ?');
	const expected: { id: string; status: string }[] = [];
	for (const [index, status] of ['draft', 'ready', 'live', 'changed', 'unpublish', 'delete', 'deleted'].entries()) {
		const id = `aaaaa${'abcdefg'[index]}`;
		const path = `${status}.md`;
		const publish = ['ready', 'live', 'changed'].includes(status);
		const deleted = ['delete', 'deleted'].includes(status);
		const frontmatter = `title: ${status}\nslug: custom-${status}\npublish: ${publish}\ndelete: ${deleted}`;
		const hash = hashPostContent(frontmatter, 'Human text');
		store.appendRevision(path, frontmatter, 'Human text', hash, 'mac');
		setId.run(id, path);
		if (['live', 'changed', 'unpublish', 'delete'].includes(status)) {
			fixture.prepare(`UPDATE posts SET published_hash = ?, published_title = ?, published_slug = ?,
				published_at = ?, published_commit = ? WHERE path = ?`)
				.run(status === 'changed' ? 'earlier-hash' : hash, status, status, '2026-01-01', 'commit', path);
		}
		expected.push({ id, status });
	}
	store.appendRevision('assistant-only.md', 'title: Assistant Only\npublish: false', '', 'human-empty', 'cms');
	setId.run('bbbbbb', 'assistant-only.md');
	store.upsertVersion({ path: 'assistant-only.md', writer: 'llm', sessionId: 'file', baseHash: 'human-empty',
		frontmatter: 'title: Assistant Proposal', body: 'Assistant text' });
	store.upsertVersion({ path: 'assistant-only.md', writer: 'llm', sessionId: 'second-assistant', baseHash: 'human-empty',
		frontmatter: 'title: Alternate', body: 'Another proposal' });
	for (const writer of ['claude', 'codex', 'phone']) {
		store.upsertVersion({ path: 'draft.md', writer, sessionId: `${writer}-session`, baseHash: 'base',
			frontmatter: 'title: Proposal', body: `${writer} text` });
	}
	fixture.prepare('UPDATE revisions SET writer = ? WHERE path = ?').run('codex', 'draft.md');
	store.setStaged('assistant-only.md', true);
	store.addToEditing('assistant-only.md');
	fixture.prepare('UPDATE posts SET llm_hash = ? WHERE path = ?').run('stale-import-hash', 'assistant-only.md');
	fixture.exec("INSERT INTO posts (path, published_hash) VALUES ('legacy-only.md', 'old')");
	mkdirSync(join(root, 'content'));
	mkdirSync(join(root, 'src/posts'), { recursive: true });
	writeFileSync(join(root, 'content/unimported.llm.md'), 'Assistant file waiting for normal ingestion');
	writeFileSync(join(root, 'content/sync-demo.md'), 'A file the corpus import would remove');
	writeFileSync(join(root, 'src/posts/unimported.svx'), 'Site text waiting for normal ingestion');
	writeFileSync(join(root, 'deploy-state.json'), '{"posts":{}}');

	const filesBefore = snapshotFiles();
	const dump = () => ['posts', 'revisions', 'versions', 'meta', 'leases']
		.map((table) => fixture!.prepare(`SELECT * FROM ${table}`).all());
	const rowsBefore = dump();
	const first = await page('?limit=3');
	assert.equal(first.posts.length, 3);
	assert.equal(first.nextCursor, 'aaaaac');
	const seen = [...first.posts];
	let cursor: string | null = first.nextCursor;
	for (let request = 0; cursor !== null && request < 4; request += 1) {
		const next = await page(`?limit=3&after=${cursor}`);
		seen.push(...next.posts);
		cursor = next.nextCursor;
	}
	assert.equal(cursor, null, 'pagination terminates');
	assert.equal(new Set(seen.map((item) => item.id)).size, 8, 'no duplicates or missing stored posts');
	assert.deepEqual(seen.slice(0, 7).map((item) => ({ id: item.id, status: item.deployStatus })), expected);
	assert.equal(seen[0].slug, 'custom-draft');
	assert.equal(seen[0].head.writer, 'codex', 'head writer is reported without claiming human authorship');
	assert.equal(seen[0].hasVersions, true, 'pending versions are available for every writer label');
	assert.deepEqual(seen[0].versions.map((version) => version.writer), ['claude', 'codex', 'phone']);
	assert.ok(!('human' in seen[0]) && !('hasAssistantDraft' in seen[0]), 'no inferred author roles');
	assert.ok(seen.every((item) => !('body' in item.head)), 'list excludes human bodies');
	assert.deepEqual(await page('?after=zzzzzz'), { posts: [], nextCursor: null });
	assert.equal((await page()).posts.length, 8);
	assert.equal((await page('?limit=8')).nextCursor, null, 'exact page boundary has no cursor');
	assert.equal((await page('?limit=1')).posts.length, 1);
	await rejects(post('cccccc'), 404);

	const assistant = await data('bbbbbb');
	assert.equal(assistant.head.body, '', 'assistant-only draft keeps an empty human version');
	assert.equal(assistant.head.rev, 1);
	assert.equal(assistant.head.writer, 'cms');
	assert.equal(assistant.head.contentHash, 'human-empty');
	assert.ok(assistant.head.savedAt);
	assert.equal(assistant.hasVersions, true);
	assert.equal(assistant.staged, true);
	assert.equal(assistant.editingOrder, 0);
	assert.deepEqual(assistant.versions.map((version) => [version.writer, version.sessionId, version.body]),
		[['llm', 'file', 'Assistant text'], ['llm2', 'second-assistant', 'Another proposal']]);
	for (const version of assistant.versions) {
		assert.equal(version.baseHash, 'human-empty');
		assert.ok(version.updatedAt);
		assert.equal(version.contentHash, hashPostContent(version.frontmatter!, version.body!));
	}
	assert.equal(seen.at(-1)!.hasVersions, true, 'empty human body does not exclude the draft');
	assert.deepEqual(snapshotFiles(), filesBefore, 'reads leave database, WAL, content, and directory entries intact');
	assert.deepEqual(dump(), rowsBefore, 'reads leave every store table intact');

	const originalExec = DatabaseSync.prototype.exec;
	let writeRejected = false;
	DatabaseSync.prototype.exec = function (sql: string) {
		originalExec.call(this, sql);
		if (sql.includes('BEGIN')) {
			originalExec.call(this, 'PRAGMA query_only = OFF');
			assert.throws(() => originalExec.call(this, "UPDATE posts SET staged = 0"), /readonly/);
			originalExec.call(this, 'PRAGMA query_only = ON');
			writeRejected = true;
		}
	};
	try {
		await get();
		assert.equal(writeRejected, true, 'the native connection rejects writes with query_only disabled');
	} finally {
		DatabaseSync.prototype.exec = originalExec;
	}

	const update = fixture.prepare('UPDATE versions SET body = ? WHERE path = ? AND writer = ?');
	const overhead = Buffer.byteLength('title: Assistant Only\npublish: false' +
		'title: Assistant Proposal' + 'title: Alternate' + 'Another proposal');
	update.run('x'.repeat(1024 * 1024 - overhead), 'assistant-only.md', 'llm');
	assert.equal((await data('bbbbbb')).versions[0].body!.length, 1024 * 1024 - overhead);
	update.run('x'.repeat(1024 * 1024 - overhead + 1), 'assistant-only.md', 'llm');
	await rejects(post('bbbbbb'), 413);
	update.run('x'.repeat(600000), 'assistant-only.md', 'llm');
	update.run('x'.repeat(600000), 'assistant-only.md', 'llm2');
	await rejects(post('bbbbbb'), 413);
	update.run('Another proposal', 'assistant-only.md', 'llm2');
	update.run('🙂'.repeat(262145), 'assistant-only.md', 'llm');
	assert.equal((await page('?after=aaaaag&limit=1')).posts[0].id, 'bbbbbb', 'list does not load large bodies');
	await rejects(post('bbbbbb'), 413);
	update.run('Assistant text', 'assistant-only.md', 'llm');
	fixture.prepare('UPDATE revisions SET body = ? WHERE path = ?').run('x'.repeat(1024 * 1024 + 1), 'draft.md');
	await rejects(post('aaaaaa'), 413);
	fixture.prepare('UPDATE revisions SET frontmatter = ? WHERE path = ?').run('x'.repeat(65537), 'draft.md');
	const oversizedFrontmatter = await page('?limit=1');
	assert.equal(oversizedFrontmatter.posts[0].oversized.frontmatter, true);
	assert.equal(oversizedFrontmatter.posts[0].title, null);
	assert.equal(oversizedFrontmatter.posts[0].deployStatus, null, 'oversized flags are unknown, not guessed');
	assert.equal(oversizedFrontmatter.posts[0].head.writer, 'codex');
	assert.equal(oversizedFrontmatter.nextCursor, 'aaaaaa');
	assert.equal((await page(`?limit=1&after=${oversizedFrontmatter.nextCursor}`)).posts[0].id, 'aaaaab');
	await rejects(post('aaaaaa'), 413);
	fixture.prepare('UPDATE revisions SET frontmatter = ? WHERE path = ?').run('title: Draft', 'draft.md');
	fixture.prepare('UPDATE posts SET published_title = ? WHERE path = ?').run('x'.repeat(4097), 'live.md');
	const oversizedMetadata = await page('?limit=1&after=aaaaab');
	assert.equal(oversizedMetadata.posts[0].oversized.metadata, true);
	assert.equal(oversizedMetadata.nextCursor, 'aaaaac');
	assert.equal((await page(`?limit=1&after=${oversizedMetadata.nextCursor}`)).posts[0].id, 'aaaaad');
	fixture.prepare('UPDATE posts SET published_title = ? WHERE path = ?').run('Live', 'live.md');
	const insert = fixture.prepare(`INSERT INTO versions
		(path, writer, session_id, base_hash, frontmatter, body, updated_at) VALUES (?, ?, '', '', '', '', '')`);
	for (let index = 0; index < 9; index += 1) insert.run('assistant-only.md', `writer-${index}`);
	await rejects(post('bbbbbb'), 413);
	const oversizedVersions = await page('?after=aaaaag&limit=1');
	assert.equal(oversizedVersions.posts[0].oversized.versions, true);
	assert.equal(oversizedVersions.posts[0].hasVersions, true);
	assert.equal(oversizedVersions.posts[0].versions.length, 10);
	assert.equal(oversizedVersions.posts[0].id, 'bbbbbb');
	fixture.prepare('DELETE FROM versions WHERE path = ? AND writer LIKE ?').run('assistant-only.md', 'writer-%');
	for (let index = 0; index < 103; index += 1) {
		allowStoreSetup = true;
		store.appendRevision(`extra-${index}.md`, 'title: Extra', '', 'hash', 'mac');
		allowStoreSetup = false;
	}
	assert.equal((await page()).posts.length, 50, 'default page is bounded');
	assert.equal((await page('?limit=100')).posts.length, 100, 'maximum page is bounded');
	const overflowVersion = fixture.prepare(`INSERT INTO versions
		(path, writer, session_id, base_hash, frontmatter, body, updated_at) VALUES (?, ?, '', '', '', '', '')`);
	for (let index = 0; index < 9; index += 1) overflowVersion.run('assistant-only.md', `writer-${index}`);
	const all: string[] = [];
	let next: string | null = null;
	for (let request = 0; request < 120; request += 1) {
		const result = await page(next === null ? '?limit=1' : `?limit=1&after=${next}`);
		all.push(...result.posts.map((item) => item.id));
		next = result.nextCursor;
		if (next === null) break;
	}
	assert.equal(all.length, 111, 'oversized posts do not prevent reaching every later record');
	assert.equal(new Set(all).size, 111);
} finally {
	hooks.deregister();
	fixture?.close();
	rmSync(root, { recursive: true, force: true });
}
