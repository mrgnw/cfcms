// node --import ./scripts/check-hooks.ts src/lib/server/db.check.ts
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = mkdtempSync(join(tmpdir(), 'cms-db-check-'));
const databasePath = join(root, 'cms.db');

// the posts table as the first release created it, holding one published post
const legacy = new DatabaseSync(databasePath);
legacy.exec(`
	CREATE TABLE posts (
		path TEXT PRIMARY KEY,
		editing_order INTEGER,
		published_hash TEXT,
		published_title TEXT,
		published_slug TEXT,
		published_commit TEXT,
		published_at TEXT
	);
	INSERT INTO posts (path, published_hash, published_title, published_slug, published_at)
	VALUES ('old-post.md', 'abc', 'Old Post', 'old-post', '2026-01-01T00:00:00.000Z');
`);
legacy.close();

process.env.BLOG_CMS_DB = databasePath;
process.env.BLOG_CONTENT_BASE_DIR = root;

try {
	const { getPublishedPosts } = await import('./db.ts');
	assert.deepEqual(Object.keys(getPublishedPosts()), ['old-post.md'], 'migration keeps existing rows');

	const migrated = new DatabaseSync(databasePath);
	const columns = (migrated.prepare(`SELECT name FROM pragma_table_info('posts')`).all() as { name: string }[]).map(
		(row) => row.name
	);
	migrated.close();
	for (const column of ['head_rev', 'exported_hash', 'llm_hash', 'staged']) assert.ok(columns.includes(column), column);

	console.log('db.check: ok');
} finally {
	rmSync(root, { recursive: true, force: true });
}
