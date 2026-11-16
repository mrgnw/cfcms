// node --import ./scripts/check-hooks.ts src/lib/server/db-triage-migration.check.ts
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = mkdtempSync(join(tmpdir(), 'cms-triage-migration-check-'));
const databasePath = join(root, 'cms.db');

// a database saved before triage_rev existed: one post with triage, one without
const earlier = new DatabaseSync(databasePath);
earlier.exec(`
	CREATE TABLE posts (
		path TEXT PRIMARY KEY,
		editing_order INTEGER,
		published_hash TEXT,
		published_title TEXT,
		published_slug TEXT,
		published_commit TEXT,
		published_at TEXT,
		next_step TEXT,
		effort TEXT
	);
	INSERT INTO posts (path, editing_order, next_step, effort) VALUES ('triaged.md', 0, 'Cut the intro', 'quick');
	INSERT INTO posts (path, editing_order) VALUES ('plain.md', 1);
`);
earlier.close();

process.env.BLOG_CMS_DB = databasePath;
process.env.BLOG_CONTENT_BASE_DIR = root;

try {
	const { getTriage, setTriageField } = await import('./db.ts');
	assert.deepEqual(
		[...getTriage()],
		[['triaged.md', { nextStep: 'Cut the intro', effort: 'quick', rev: 1 }]],
		'triage saved before revisions stays visible, at rev 1'
	);
	assert.deepEqual(setTriageField('triaged.md', 'effort', 'deep', 'quick'), { saved: true, current: 'deep', rev: 2 });
	console.log('db-triage-migration.check: ok');
} finally {
	rmSync(root, { recursive: true, force: true });
}
