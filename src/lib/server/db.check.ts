// node --import ./scripts/check-hooks.ts src/lib/server/db.check.ts
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hashPostContent } from '../post-text.ts';

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
	CREATE TABLE versions (
		path TEXT NOT NULL, writer TEXT NOT NULL, session_id TEXT NOT NULL, base_hash TEXT NOT NULL,
		frontmatter TEXT NOT NULL, body TEXT NOT NULL, updated_at TEXT NOT NULL,
		PRIMARY KEY (path, writer)
	);
	INSERT INTO versions VALUES ('old-post.md', 'llm', 'file', 'abc', 'title: Old Post', 'Old suggestion', '2026-01-01');
`);
legacy.exec('ALTER TABLE posts ADD COLUMN llm_hash TEXT');
const importedHash = hashPostContent('title: Old Post', 'Old suggestion');
legacy.prepare('UPDATE posts SET llm_hash = ? WHERE path = ?').run(importedHash, 'old-post.md');
legacy.prepare('INSERT INTO posts (path, llm_hash) VALUES (?, ?)').run('api-edited.md', importedHash);
legacy.prepare('INSERT INTO versions VALUES (?, ?, ?, ?, ?, ?, ?)').run(
	'api-edited.md', 'llm', 'file', 'abc', 'title: Old Post', 'New API suggestion', '2026-01-01'
);
legacy.close();

process.env.BLOG_CMS_DB = databasePath;
process.env.BLOG_CONTENT_BASE_DIR = root;

try {
	const { getPublishedPosts, listVersions } = await import('./db.ts');
	assert.deepEqual(Object.keys(getPublishedPosts()), ['old-post.md'], 'migration keeps existing rows');
	const suggestion = listVersions('old-post.md')[0];
	assert.equal(suggestion.body, 'Old suggestion');
	assert.match(suggestion.revision, /^[a-f0-9]{32}$/);

	const migrated = new DatabaseSync(databasePath);
	const columns = (migrated.prepare(`SELECT name FROM pragma_table_info('posts')`).all() as { name: string }[]).map(
		(row) => row.name
	);
	assert.equal((migrated.prepare('SELECT llm_version_revision FROM posts WHERE path = ?').get('old-post.md') as {
		llm_version_revision: string;
	}).llm_version_revision, suggestion.revision, 'migration anchors a reference matching its imported file');
	assert.equal((migrated.prepare('SELECT llm_version_revision FROM posts WHERE path = ?').get('api-edited.md') as {
		llm_version_revision: string | null;
	}).llm_version_revision, null, 'migration does not treat an API edit as the last imported file');
	migrated.close();
	for (const column of ['head_rev', 'exported_hash', 'llm_hash', 'llm_version_revision', 'staged',
		'next_step', 'effort', 'triage_rev']) assert.ok(columns.includes(column), column);

	const { appendRevision, labelRevision, listRevisions } = await import('./db.ts');
	appendRevision('busy.md', '', 'v1', 'h1', 'mac');
	appendRevision('busy.md', '', 'v2', 'h2', 'mac');
	assert.ok(labelRevision('busy.md', 2, 'checkpoint'));
	assert.ok(!labelRevision('busy.md', 99, 'missing'), 'labelling an unknown revision reports no change');
	for (let rev = 3; rev <= 203; rev += 1) appendRevision('busy.md', '', `v${rev}`, `h${rev}`, 'mac');
	const kept = listRevisions('busy.md').map((entry) => entry.rev);
	assert.ok(kept.includes(2), 'a named revision outlives the autosave cap');
	assert.ok(!kept.includes(3), 'unnamed revisions past the cap are pruned');
	assert.equal(kept[0], 203, 'newest first');

	const {
		addToEditing,
		removeFromEditing,
		getTriage,
		setTriageField,
		reorderEditing,
		getEditingOrder,
		recordPublished
	} = await import(
		'./db.ts'
	);
	addToEditing('draft.md');
	assert.deepEqual(setTriageField('draft.md', 'nextStep', 'Cut the intro', null), {
		saved: true,
		current: 'Cut the intro',
		rev: 1
	});
	assert.deepEqual(setTriageField('draft.md', 'effort', 'quick', null), { saved: true, current: 'quick', rev: 2 });
	removeFromEditing('draft.md');
	assert.deepEqual(
		getTriage().get('draft.md'),
		{ nextStep: 'Cut the intro', effort: 'quick', rev: 2 },
		'triage outlives the queue'
	);

	// two sessions both saw "Cut the intro"; the second save must not overwrite the first
	assert.ok(setTriageField('draft.md', 'nextStep', 'Add a photo', 'Cut the intro').saved);
	assert.deepEqual(
		setTriageField('draft.md', 'nextStep', 'Fix links', 'Cut the intro'),
		{ saved: false, current: 'Add a photo', rev: 3 },
		'a stale session is refused and told the current value'
	);
	assert.ok(setTriageField('draft.md', 'nextStep', 'Add a photo', 'Cut the intro').saved, 'a repeated save is idempotent');
	assert.equal(getTriage().get('draft.md')?.effort, 'quick', 'saving one field leaves the other alone');
	assert.ok(setTriageField('draft.md', 'effort', null, 'quick').saved);
	assert.ok(setTriageField('draft.md', 'nextStep', null, 'Add a photo').saved);
	assert.deepEqual(
		getTriage().get('draft.md'),
		{ nextStep: null, effort: null, rev: 6 },
		'a cleared post keeps its rev, so other sessions can tell the clear is newer'
	);
	assert.throws(() => setTriageField('draft.md', 'nextStep', 'x'.repeat(141), null), /too long/);
	assert.throws(() => setTriageField('draft.md', 'effort', 'someday', null), /Unknown effort/);

	// an assistant-only draft has no head_rev, so only its triage row remembers the rev
	assert.ok(setTriageField('assistant.llm.md', 'nextStep', 'Check facts', null).saved);
	assert.ok(setTriageField('assistant.llm.md', 'nextStep', null, 'Check facts').saved);
	addToEditing('other.md');
	removeFromEditing('other.md');
	recordPublished([], null);
	assert.deepEqual(
		getTriage().get('assistant.llm.md'),
		{ nextStep: null, effort: null, rev: 2 },
		'queue and publish cleanups keep a cleared triage row'
	);
	assert.equal(setTriageField('assistant.llm.md', 'effort', 'quick', null).rev, 3, 'the next save keeps counting up');

	for (const path of ['a.md', 'b.md', 'c.md', 'd.md']) addToEditing(path);
	reorderEditing(['d.md', 'b.md']);
	assert.deepEqual([...getEditingOrder().keys()], ['a.md', 'd.md', 'c.md', 'b.md'], 'a filtered reorder keeps the others in place');
	assert.throws(() => reorderEditing(['a.md', 'a.md']), /repeats/);
	assert.throws(() => reorderEditing(['missing.md']), /unknown/);
	assert.deepEqual([...getEditingOrder().keys()], ['a.md', 'd.md', 'c.md', 'b.md'], 'a refused reorder changes nothing');

	console.log('db.check: ok');
} finally {
	rmSync(root, { recursive: true, force: true });
}
