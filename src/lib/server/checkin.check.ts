// node --import ./scripts/check-hooks.ts src/lib/server/checkin.check.ts
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hashPostContent } from '../post-text.ts';

const root = mkdtempSync(join(tmpdir(), 'cms-checkin-check-'));
const basePath = join(root, 'base.db');
process.env.BLOG_CMS_DB = basePath;
process.env.BLOG_CONTENT_BASE_DIR = root;

const save = (db: DatabaseSync, path: string, body: string, id?: string) => {
	const row = db.prepare('SELECT head_rev FROM posts WHERE path = ?').get(path) as { head_rev: number } | undefined;
	const rev = (row?.head_rev ?? 0) + 1;
	if (row) db.prepare('UPDATE posts SET head_rev = ? WHERE path = ?').run(rev, path);
	else db.prepare('INSERT INTO posts (path, head_rev, id) VALUES (?, ?, ?)').run(path, rev, id ?? null);
	db.prepare('INSERT INTO revisions (path, rev, hash, frontmatter, body, writer, saved_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
		.run(path, rev, hashPostContent('title: T', body), 'title: T', body, 'air', new Date().toISOString());
};

const head = (db: DatabaseSync, path: string) => db.prepare(`
	SELECT posts.id, posts.head_rev, revisions.body, revisions.hash FROM posts
	JOIN revisions ON revisions.path = posts.path AND revisions.rev = posts.head_rev WHERE posts.path = ?
`).get(path) as { id: string; head_rev: number; body: string; hash: string };

try {
	const { appendRevision, vacuumInto } = await import('./db.ts');
	const { formatPlan, runCheckin } = await import('./checkin.ts');
	for (const path of ['offline-only.md', 'both.md', 'untouched.md', 'round-trip.md', 'gone.md', 'same-both.md', 'already-pending.md', 'offline-back.md', 'mini-back.md']) {
		appendRevision(path, 'title: T', 'base text', hashPostContent('title: T', 'base text'), 'mini');
	}
	vacuumInto(join(root, 'offline.db'));
	vacuumInto(join(root, 'mini.db'));

	const base = new DatabaseSync(basePath, { readOnly: true });
	const offline = new DatabaseSync(join(root, 'offline.db'));
	const mini = new DatabaseSync(join(root, 'mini.db'));
	const baseBoth = head(base, 'both.md');

	save(offline, 'offline-only.md', 'offline draft 1');
	save(offline, 'offline-only.md', 'offline draft 2');
	save(offline, 'both.md', 'offline edit');
	save(offline, 'new.md', 'written on the plane', 'p34n7x');
	save(offline, 'clash.md', 'offline clash', 'c7a4hx');
	save(offline, 'round-trip.md', 'a detour');
	save(offline, 'round-trip.md', 'base text');
	save(offline, 'twin-a.md', 'same words', 'tw7nab');
	const pend = (db: DatabaseSync, path: string, writer: string, body: string) => db.prepare(`
		INSERT INTO versions (path, writer, session_id, base_hash, frontmatter, body, updated_at, revision)
		VALUES (?, ?, 'tab2', ?, 'title: T', ?, '2026-11-26', ?)
	`).run(path, writer, head(db, path).hash, body, `${path}-${writer}`);
	pend(offline, 'clash.md', 'air2', 'second tab on the clashing post');
	pend(offline, 'gone.md', 'air2', 'second tab on a post the mini deleted');
	for (const table of ['versions', 'revisions', 'posts']) mini.prepare(`DELETE FROM ${table} WHERE path = ?`).run('gone.md');
	save(mini, 'gone.md', 'a new mini post reusing the path', 'g7n3wp');
	save(mini, 'both.md', 'mini edit');
	save(offline, 'same-both.md', 'identical edit');
	save(mini, 'same-both.md', 'identical edit');
	save(offline, 'already-pending.md', 'offline words');
	save(mini, 'already-pending.md', 'mini words');
	pend(mini, 'already-pending.md', 'offline', 'offline words');
	save(offline, 'offline-back.md', 'offline detour');
	save(offline, 'offline-back.md', 'base text');
	save(mini, 'offline-back.md', 'mini edit');
	save(offline, 'mini-back.md', 'offline edit');
	save(mini, 'mini-back.md', 'mini detour');
	save(mini, 'mini-back.md', 'base text');
	save(mini, 'twin-b.md', 'same words', 'tw7nbc');
	save(mini, 'clash.md', 'mini clash', 'c7a4hx');

	const dbs = { base, offline, mini };
	const checkoutId = 'checkout-1';
	let backedUp = false;
	const plan = runCheckin(dbs, {
		apply: true,
		checkoutId,
		backup: () => {
			const daemon = new DatabaseSync(join(root, 'mini.db'));
			assert.throws(() => daemon.exec('BEGIN IMMEDIATE'), /locked/, 'the mini is write-locked from plan to commit');
			daemon.close();
			backedUp = true;
		}
	});
	assert.ok(backedUp);
	assert.deepEqual(plan.actions.map((action) => `${action.kind} ${action.path}`).sort(), [
		'conflict already-pending.md', 'conflict both.md', 'conflict mini-back.md', 'conflict offline-back.md', 'conflict same-both.md', 'create clash-2.md', 'create new.md', 'create twin-a.md', 'fast-forward offline-only.md',
		'fast-forward round-trip.md', 'version clash-2.md'
	], formatPlan(plan));
	assert.ok(plan.skipped.some((note) => note.startsWith('gone.md (air2)')), formatPlan(plan));

	const forwarded = head(mini, 'offline-only.md');
	assert.equal(forwarded.body, 'offline draft 2', 'offline-only change becomes the head');
	assert.equal(forwarded.head_rev, 3);
	assert.equal((mini.prepare('SELECT body FROM revisions WHERE path = ? AND rev = 2').get('offline-only.md') as { body: string }).body,
		'offline draft 1', 'offline history comes along');

	assert.equal(head(mini, 'both.md').body, 'mini edit', 'a post changed on both sides keeps the mini head');
	const pending = mini.prepare('SELECT writer, base_hash, body, revision FROM versions WHERE path = ?').all('both.md') as {
		writer: string; base_hash: string; body: string; revision: string;
	}[];
	assert.equal(pending.length, 1);
	assert.equal(pending[0].writer, 'offline');
	assert.equal(pending[0].base_hash, baseBoth.hash, 'pending version is based on the checkout head');
	assert.equal(pending[0].body, 'offline edit');
	assert.match(pending[0].revision, /^[0-9a-f-]{36}$/);

	assert.equal(head(mini, 'new.md').id, 'p34n7x', 'a post created offline keeps its id');
	assert.equal(head(mini, 'new.md').body, 'written on the plane');
	assert.equal(head(mini, 'clash.md').body, 'mini clash');
	const moved = head(mini, 'clash-2.md');
	assert.equal(moved.body, 'offline clash');
	assert.notEqual(moved.id, 'c7a4hx', 'a colliding id is replaced');
	const versionsOf = (path: string) => (mini.prepare('SELECT body FROM versions WHERE path = ?').all(path) as { body: string }[])
		.map((row) => row.body);
	assert.deepEqual(versionsOf('clash-2.md'), ['second tab on the clashing post'], 'versions follow a remapped post');
	assert.deepEqual(versionsOf('clash.md'), []);
	assert.deepEqual(versionsOf('gone.md'), [], 'a version never attaches to another post at the same path');
	assert.equal(head(mini, 'untouched.md').head_rev, 1);

	const pendingOf = (path: string) => mini.prepare('SELECT writer, body FROM versions WHERE path = ? ORDER BY writer').all(path)
		.map((row) => `${row.writer}: ${row.body}`);
	assert.deepEqual(pendingOf('same-both.md'), ['offline: identical edit'], 'same text on both sides still becomes a version');
	assert.deepEqual(pendingOf('already-pending.md'), ['offline: offline words', 'offline2: offline words'],
		'an existing version with the same text is not taken as the check-in');
	assert.deepEqual(pendingOf('offline-back.md'), ['offline: base text'], 'offline returning to the base text is still a change');
	assert.deepEqual(pendingOf('mini-back.md'), ['offline: offline edit'], 'the mini returning to the base text is still a change');
	for (const path of ['same-both.md', 'already-pending.md', 'offline-back.md', 'mini-back.md']) {
		assert.equal(head(mini, path).head_rev, path === 'mini-back.md' ? 3 : 2, `${path} keeps the mini head`);
	}

	const roundTrip = head(mini, 'round-trip.md');
	assert.equal(roundTrip.head_rev, 3, 'edits that return to the base text still bring their history');
	assert.equal((mini.prepare('SELECT body FROM revisions WHERE path = ? AND rev = 2').get('round-trip.md') as { body: string }).body,
		'a detour');
	assert.equal(head(mini, 'twin-a.md').id, 'tw7nab', 'a new post is kept even when another post has the same text');
	assert.equal(head(mini, 'twin-b.md').id, 'tw7nbc');

	save(offline, 'new.md', 'edited on the plane after the check-in');
	assert.throws(() => runCheckin(dbs, { apply: true, checkoutId }), /already checked in/, 'a checkout applies once');
	assert.throws(() => runCheckin(dbs, { apply: false, checkoutId }), /already checked in/);
	assert.equal(head(mini, 'new.md').body, 'written on the plane');

	assert.equal(plan.fastPath, false, 'a mini changed since checkout is merged, not replaced');

	vacuumInto(join(root, 'fast-offline.db'));
	vacuumInto(join(root, 'fast-mini.db'));
	const fastOffline = new DatabaseSync(join(root, 'fast-offline.db'));
	const fastMini = new DatabaseSync(join(root, 'fast-mini.db'));
	fastMini.prepare("INSERT INTO meta (key, value) VALUES ('lastBackupAt', 'mini')").run();
	save(fastOffline, 'both.md', 'edited on the plane');
	save(fastOffline, 'fresh.md', 'new on the plane', 'fr3shx');
	fastOffline.prepare("UPDATE posts SET next_step = 'tighten intro', triage_rev = 1 WHERE path = 'untouched.md'").run();
	for (const table of ['revisions', 'posts']) fastOffline.prepare(`DELETE FROM ${table} WHERE path = ?`).run('gone.md');
	const fast = { base, offline: fastOffline, mini: fastMini };
	const preview = runCheckin(fast, { apply: false, checkoutId: 'checkout-2' });
	assert.equal(preview.fastPath, true, formatPlan(preview));
	runCheckin(fast, { apply: true, checkoutId: 'checkout-2' });
	const dump = (db: DatabaseSync) => ['posts ORDER BY path', 'revisions ORDER BY path, rev', 'versions ORDER BY path, writer']
		.map((query) => JSON.stringify(db.prepare(`SELECT * FROM ${query}`).all()));
	assert.deepEqual(dump(fastMini), dump(fastOffline), 'an unchanged mini takes the offline content whole');
	assert.equal((fastMini.prepare("SELECT value FROM meta WHERE key = 'lastBackupAt'").get() as { value: string }).value, 'mini',
		'the mini keeps its own meta');
	assert.throws(() => runCheckin(fast, { apply: true, checkoutId: 'checkout-2' }), /already checked in/);
	fastOffline.close();
	fastMini.close();

	copyFileSync(join(root, 'mini.db'), join(root, 'newer.db'));
	const newer = new DatabaseSync(join(root, 'newer.db'));
	newer.exec('ALTER TABLE posts ADD COLUMN pinned INTEGER');
	assert.throws(() => runCheckin({ base, offline, mini: newer }, { apply: true, checkoutId: 'other' }), /Schema mismatch in posts/);
	assert.equal(newer.isTransaction, false, 'a failed check-in releases the lock');
	for (const db of [base, offline, mini, newer]) db.close();
} finally {
	rmSync(root, { recursive: true, force: true });
}
console.log('checkin ok');
