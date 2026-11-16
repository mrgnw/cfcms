import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = mkdtempSync(join(tmpdir(), 'cms-inventory-storage-'));
const databasePath = join(root, 'cms.db');
process.env.BLOG_CMS_DB = databasePath;
process.env.BLOG_CONTENT_BASE_DIR = root;
const { listInventory } = await import('./inventory.ts');

let writer: DatabaseSync | undefined;
try {
	writer = new DatabaseSync(databasePath);
	writer.exec(`
		PRAGMA journal_mode = WAL;
		CREATE TABLE posts (id TEXT UNIQUE, path TEXT PRIMARY KEY, head_rev INTEGER, published_hash TEXT,
			published_title TEXT, published_slug TEXT, published_commit TEXT, published_at TEXT,
			staged INTEGER, editing_order INTEGER);
		CREATE TABLE revisions (path TEXT, rev INTEGER, hash TEXT, writer TEXT, saved_at TEXT,
			frontmatter TEXT, body TEXT, PRIMARY KEY(path, rev));
		CREATE TABLE versions (path TEXT, writer TEXT, session_id TEXT, base_hash TEXT,
			updated_at TEXT, frontmatter TEXT, body TEXT, PRIMARY KEY(path, writer));
		INSERT INTO posts (id, path, head_rev) VALUES ('aaaaaa', 'post.md', 1);
		INSERT INTO revisions VALUES ('post.md', 1, 'head-1', 'codex', '2026-01-01', 'title: Before', '');
		INSERT INTO versions VALUES ('post.md', 'claude', 'session', 'head-1', '2026-01-01', '', 'Proposal');
	`);
	writer.close();
	writer = undefined;
	assert.deepEqual(readdirSync(root), ['cms.db'], 'last writer removes WAL coordination sidecars');
	const mainBefore = readFileSync(databasePath);
	assert.equal(listInventory(1, null).posts[0].title, 'Before');
	assert.deepEqual(readFileSync(databasePath), mainBefore, 'idle WAL read leaves database bytes unchanged');
	assert.deepEqual(readdirSync(root).sort(), ['cms.db', 'cms.db-shm', 'cms.db-wal'],
		'SQLite can create coordination sidecars even through a native read-only connection');
	assert.equal(statSync(`${databasePath}-wal`).size, 0, 'reader does not append a WAL transaction');

	writer = new DatabaseSync(databasePath);
	writer.exec("PRAGMA wal_autocheckpoint = 0; UPDATE revisions SET frontmatter = 'title: Committed in WAL'");
	assert.deepEqual(readFileSync(databasePath), mainBefore, 'the new title only exists in committed WAL frames');
	const walBefore = readFileSync(`${databasePath}-wal`);
	assert.ok(walBefore.length > 0);
	assert.equal(listInventory(1, null).posts[0].title, 'Committed in WAL', 'live read includes committed WAL frames');
	assert.deepEqual(readFileSync(databasePath), mainBefore);
	assert.deepEqual(readFileSync(`${databasePath}-wal`), walBefore, 'reader does not append or checkpoint WAL');

	const originalPrepare = DatabaseSync.prototype.prepare;
	let interleaved = false;
	DatabaseSync.prototype.prepare = function (sql: string, ...args) {
		if (!interleaved && sql.includes('FROM versions v JOIN posts p')) {
			interleaved = true;
			writer!.exec(`
				BEGIN;
				INSERT INTO revisions VALUES ('post.md', 2, 'head-2', 'claude', '2026-01-02', 'title: Next', '');
				UPDATE posts SET head_rev = 2;
				UPDATE versions SET base_hash = 'head-2';
				COMMIT;
			`);
		}
		return originalPrepare.call(this, sql, ...args);
	};
	try {
		const snapshot = listInventory(1, null).posts[0];
		assert.equal(interleaved, true);
		assert.equal(snapshot.head.rev, 1);
		assert.equal(snapshot.versions[0].baseHash, 'head-1', 'all queries in a request use one read snapshot');
	} finally {
		DatabaseSync.prototype.prepare = originalPrepare;
	}
	const next = listInventory(1, null).posts[0];
	assert.equal(next.head.rev, 2, 'the next request observes the committed revision');
	assert.equal(next.head.writer, 'claude');
	assert.equal(next.versions[0].baseHash, 'head-2');
	writer.exec("BEGIN IMMEDIATE; UPDATE revisions SET frontmatter = 'title: Uncommitted' WHERE rev = 2");
	try {
		assert.equal(listInventory(1, null).posts[0].title, 'Next', 'WAL readers do not see uncommitted writes');
	} finally {
		writer.exec('ROLLBACK');
	}

	writer.exec('PRAGMA journal_mode = DELETE; BEGIN EXCLUSIVE');
	const started = performance.now();
	try {
		assert.throws(() => listInventory(1, null), (caught: { status: number; body: { message: string } }) => {
			assert.equal(caught.status, 503);
			assert.match(caught.body.message, /busy/);
			return true;
		});
		assert.ok(performance.now() - started < 2000, 'lock contention has a bounded timeout');
	} finally {
		writer.exec('ROLLBACK');
	}
	assert.equal(listInventory(1, null).posts[0].title, 'Next', 'reads resume after lock release');

	const unexpected = new TypeError('unexpected inventory fault');
	for (const fault of ['callback', 'sql']) {
		DatabaseSync.prototype.prepare = function (sql: string, ...args) {
			if (sql.includes('FROM posts p JOIN revisions r')) {
				if (fault === 'callback') throw unexpected;
				return originalPrepare.call(this, 'SELECT inventory_missing_function(1)');
			}
			return originalPrepare.call(this, sql, ...args);
		};
		try {
			assert.throws(() => listInventory(1, null), (caught: unknown) => {
				if (fault === 'callback') assert.equal(caught, unexpected);
				else assert.match(String(caught), /no such function/);
				assert.ok(caught instanceof Error && !('status' in caught), 'unexpected faults reach the server as errors');
				return true;
			});
		} finally {
			DatabaseSync.prototype.prepare = originalPrepare;
		}
	}
	writer.close();
	writer = undefined;
	writeFileSync(databasePath, 'invalid database bytes');
	assert.throws(() => listInventory(1, null), (caught: { code: string; errcode: number }) =>
		caught.code === 'ERR_SQLITE_ERROR' && caught.errcode === 26);
} finally {
	writer?.close();
	rmSync(root, { recursive: true, force: true });
}
