import { BLOG_CMS_DEPLOY_STATE_FILE } from '$app/env/private';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { contentBaseDirectory, databasePath } from './paths';
import { randomPostId } from '#lib/post-id.js';

// Lazy init: opening at module load would run during `vite build` with
// build-time cwd/env and poison the db with a wrong-path legacy import.
let instance: DatabaseSync | null = null;

const db = () => {
	if (instance) return instance;

	mkdirSync(dirname(databasePath), { recursive: true });
	instance = new DatabaseSync(databasePath);
	instance.exec(`
		PRAGMA journal_mode = WAL;

		CREATE TABLE IF NOT EXISTS posts (
			path TEXT PRIMARY KEY,
			editing_order INTEGER,
			published_hash TEXT,
			published_title TEXT,
			published_slug TEXT,
			published_commit TEXT,
			published_at TEXT
		);

		CREATE TABLE IF NOT EXISTS meta (
			key TEXT PRIMARY KEY,
			value TEXT
		);

		CREATE TABLE IF NOT EXISTS versions (
			path TEXT NOT NULL,
			writer TEXT NOT NULL,
			session_id TEXT NOT NULL,
			base_hash TEXT NOT NULL,
			frontmatter TEXT NOT NULL,
			body TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			PRIMARY KEY (path, writer)
		);

		CREATE TABLE IF NOT EXISTS leases (
			writer TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			seen_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS revisions (
			path TEXT NOT NULL,
			rev INTEGER NOT NULL,
			hash TEXT NOT NULL,
			frontmatter TEXT NOT NULL,
			body TEXT NOT NULL,
			writer TEXT NOT NULL,
			saved_at TEXT NOT NULL,
			PRIMARY KEY (path, rev)
		);
		CREATE INDEX IF NOT EXISTS revisions_by_hash ON revisions(path, hash);
	`);

	const postColumns = new Set(
		(instance.prepare(`SELECT name FROM pragma_table_info('posts')`).all() as { name: string }[]).map(
			(row) => row.name
		)
	);
	const newColumns: [string, string][] = [
		['head_rev', 'INTEGER'],
		['exported_hash', 'TEXT'],
		['exported_mtime_ms', 'INTEGER'],
		['llm_hash', 'TEXT'],
		['llm_mtime_ms', 'INTEGER'],
		['staged', 'INTEGER'],
		['id', 'TEXT']
	];
	for (const [name, type] of newColumns) {
		if (!postColumns.has(name)) instance.exec(`ALTER TABLE posts ADD COLUMN ${name} ${type}`);
	}
	instance.exec('CREATE UNIQUE INDEX IF NOT EXISTS posts_by_id ON posts(id)');
	const revisionColumns = instance.prepare(`SELECT name FROM pragma_table_info('revisions')`).all() as { name: string }[];
	if (!revisionColumns.some((row) => row.name === 'label')) instance.exec('ALTER TABLE revisions ADD COLUMN label TEXT');
	backfillPostIds();

	instance.exec("UPDATE versions SET writer = 'site' WHERE writer = 'live'; UPDATE revisions SET writer = 'site' WHERE writer = 'live'");
	importLegacyDeployState();
	return instance;
};

const maxIdAttempts = 8;

const newPostId = () => {
	const taken = db().prepare('SELECT 1 FROM posts WHERE id = ?');
	for (let attempt = 0; attempt < maxIdAttempts; attempt += 1) {
		const id = randomPostId();
		if (!taken.get(id)) return id;
	}
	throw new Error(`No free post id after ${maxIdAttempts} attempts`);
};

const backfillPostIds = () => {
	const missing = db().prepare('SELECT path FROM posts WHERE id IS NULL AND head_rev IS NOT NULL').all() as {
		path: string;
	}[];
	const assign = db().prepare('UPDATE posts SET id = ? WHERE path = ?');
	for (const row of missing) assign.run(newPostId(), row.path);
};

export const getPathById = (id: string): string | null => {
	const row = db().prepare('SELECT path FROM posts WHERE id = ? AND head_rev IS NOT NULL').get(id) as { path: string } | undefined;

	return row?.path ?? null;
};

const getMeta =(key: string): string | null => {
	const row = db().prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
	return row?.value ?? null;
};

const setMeta = (key: string, value: string) => {
	db().prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?').run(
		key,
		value,
		value
	);
};

type LegacyDeployState = {
	lastPublishedAt: string | null;
	posts: Record<string, { hash: string; title: string; slug: string; deployedAt: string }>;
};

const importLegacyDeployState = () => {
	if (getMeta('importedLegacyDeployState')) return;

	const legacyDeployStatePath = resolve(BLOG_CMS_DEPLOY_STATE_FILE ?? resolve(contentBaseDirectory, '.cms/deploy-state.json'));

	if (existsSync(legacyDeployStatePath)) {
		const legacy = JSON.parse(readFileSync(legacyDeployStatePath, 'utf8')) as LegacyDeployState;
		const insert = db().prepare(`
			INSERT INTO posts (path, published_hash, published_title, published_slug, published_at)
			VALUES (?, ?, ?, ?, ?)
			ON CONFLICT(path) DO UPDATE SET
				published_hash = excluded.published_hash,
				published_title = excluded.published_title,
				published_slug = excluded.published_slug,
				published_at = excluded.published_at
		`);

		db().exec('BEGIN');
		for (const [path, post] of Object.entries(legacy.posts ?? {})) {
			insert.run(path, post.hash, post.title, post.slug, post.deployedAt);
		}
		if (legacy.lastPublishedAt) setMeta('lastPublishedAt', legacy.lastPublishedAt);
		db().exec('COMMIT');
	}

	setMeta('importedLegacyDeployState', new Date().toISOString());
};

export type PublishedPostState = {
	hash: string;
	title: string;
	slug: string;
	deployedAt: string;
	commit: string | null;
};

export const getLastPublishedAt = () => getMeta('lastPublishedAt');

export const getPublishedPosts = (): Record<string, PublishedPostState> => {
	const rows = db()
		.prepare(
			`SELECT path, published_hash, published_title, published_slug, published_commit, published_at
			 FROM posts WHERE published_hash IS NOT NULL`
		)
		.all() as {
		path: string;
		published_hash: string;
		published_title: string;
		published_slug: string;
		published_commit: string | null;
		published_at: string;
	}[];

	return Object.fromEntries(
		rows.map((row) => [
			row.path,
			{
				hash: row.published_hash,
				title: row.published_title,
				slug: row.published_slug,
				deployedAt: row.published_at,
				commit: row.published_commit
			}
		])
	);
};

export const recordPublished = (
	posts: { path: string; title: string; slug: string; contentHash: string }[],
	commit: string | null
) => {
	const deployedAt = new Date().toISOString();
	const upsert = db().prepare(`
		INSERT INTO posts (path, published_hash, published_title, published_slug, published_commit, published_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(path) DO UPDATE SET
			published_hash = excluded.published_hash,
			published_title = excluded.published_title,
			published_slug = excluded.published_slug,
			published_commit = excluded.published_commit,
			published_at = excluded.published_at
	`);

	db().exec('BEGIN');
	db().prepare('UPDATE posts SET published_hash = NULL, published_commit = NULL, published_at = NULL').run();
	for (const post of posts) {
		upsert.run(post.path, post.contentHash, post.title, post.slug, commit, deployedAt);
	}
	db()
		.prepare('DELETE FROM posts WHERE published_hash IS NULL AND editing_order IS NULL AND head_rev IS NULL')
		.run();
	setMeta('lastPublishedAt', deployedAt);
	db().exec('COMMIT');

	return deployedAt;
};

export const getEditingOrder = (): Map<string, number> => {
	const rows = db()
		.prepare('SELECT path, editing_order FROM posts WHERE editing_order IS NOT NULL ORDER BY editing_order')
		.all() as { path: string; editing_order: number }[];

	return new Map(rows.map((row, index) => [row.path, index]));
};

export const addToEditing = (path: string) => {
	const max = db().prepare('SELECT COALESCE(MAX(editing_order), -1) AS max FROM posts').get() as { max: number };
	db().prepare(
		`INSERT INTO posts (path, editing_order) VALUES (?, ?)
		 ON CONFLICT(path) DO UPDATE SET editing_order = COALESCE(posts.editing_order, excluded.editing_order)`
	).run(path, max.max + 1);
};

export const removeFromEditing = (path: string) => {
	db().exec('BEGIN');
	db().prepare('UPDATE posts SET editing_order = NULL WHERE path = ?').run(path);
	db()
		.prepare('DELETE FROM posts WHERE published_hash IS NULL AND editing_order IS NULL AND head_rev IS NULL')
		.run();
	db().exec('COMMIT');
};

export const reorderEditing = (paths: string[]) => {
	if (paths.length > 500) throw new Error('Editing queue reorder exceeds sane bounds');

	const current = getEditingOrder();
	const update = db().prepare('UPDATE posts SET editing_order = ? WHERE path = ?');

	db().exec('BEGIN');
	for (const [index, path] of paths.entries()) {
		if (!current.has(path)) {
			db().exec('ROLLBACK');
			throw new Error(`Cannot reorder unknown queue entry: ${path}`);
		}
		update.run(index, path);
	}
	db().exec('COMMIT');
};

export const seedEditingQueue = (paths: string[]) => {
	if (getMeta('seededEditingQueue')) return false;

	for (const path of paths) addToEditing(path);
	setMeta('seededEditingQueue', new Date().toISOString());
	return paths.length > 0;
};

export type WriterVersion = {
	path: string;
	writer: string;
	sessionId: string;
	baseHash: string;
	frontmatter: string;
	body: string;
	updatedAt: string;
};

const versionWriterLimit = 10;

export const upsertVersion = (version: Omit<WriterVersion, 'updatedAt'>): string => {
	const now = new Date().toISOString();
	const owner = db().prepare('SELECT session_id FROM versions WHERE path = ? AND writer = ?');
	const write = db().prepare(`
		INSERT INTO versions (path, writer, session_id, base_hash, frontmatter, body, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(path, writer) DO UPDATE SET
			base_hash = excluded.base_hash,
			frontmatter = excluded.frontmatter,
			body = excluded.body,
			updated_at = excluded.updated_at
	`);

	for (let attempt = 0; attempt < versionWriterLimit; attempt += 1) {
		const writer = attempt === 0 ? version.writer : `${version.writer}${attempt + 1}`;
		const existing = owner.get(version.path, writer) as { session_id: string } | undefined;

		if (existing && existing.session_id !== version.sessionId) continue;

		write.run(version.path, writer, version.sessionId, version.baseHash, version.frontmatter, version.body, now);
		return writer;
	}

	throw new Error(`No free writer label for ${version.writer} on ${version.path}`);
};

export const listVersions = (path: string): WriterVersion[] => {
	const rows = db()
		.prepare(
			'SELECT path, writer, session_id, base_hash, frontmatter, body, updated_at FROM versions WHERE path = ? ORDER BY writer'
		)
		.all(path) as {
		path: string;
		writer: string;
		session_id: string;
		base_hash: string;
		frontmatter: string;
		body: string;
		updated_at: string;
	}[];

	return rows.map((row) => ({
		path: row.path,
		writer: row.writer,
		sessionId: row.session_id,
		baseHash: row.base_hash,
		frontmatter: row.frontmatter,
		body: row.body,
		updatedAt: row.updated_at
	}));
};

export const deleteVersion = (path: string, writer: string) => {
	db().prepare('DELETE FROM versions WHERE path = ? AND writer = ?').run(path, writer);
};

const leaseGraceMs = 40_000;

export const claimWriter = (requested: string, sessionId: string): string => {
	const now = Date.now();
	const owner = db().prepare('SELECT session_id, seen_at FROM leases WHERE writer = ?');
	const write = db().prepare(`
		INSERT INTO leases (writer, session_id, seen_at) VALUES (?, ?, ?)
		ON CONFLICT(writer) DO UPDATE SET session_id = excluded.session_id, seen_at = excluded.seen_at
	`);

	for (let attempt = 0; attempt < versionWriterLimit; attempt += 1) {
		const writer = attempt === 0 ? requested : `${requested}${attempt + 1}`;
		const existing = owner.get(writer) as { session_id: string; seen_at: string } | undefined;
		const heldByOther =
			existing && existing.session_id !== sessionId && now - Date.parse(existing.seen_at) < leaseGraceMs;

		if (heldByOther) continue;

		write.run(writer, sessionId, new Date(now).toISOString());
		return writer;
	}

	throw new Error(`No free writer lease for ${requested}`);
};

export type StoredPost = {
	path: string;
	rev: number;
	hash: string;
	frontmatter: string;
	body: string;
	writer: string;
	savedAt: string;
	publishedHash: string | null;
	exportedHash: string | null;
	exportedMtimeMs: number | null;
	llmHash: string | null;
	llmMtimeMs: number | null;
	id: string;
};

// named revisions are checkpoints: only unnamed autosaves count against the cap
const revisionCap = 200;

const pruneRevisions = (path: string, headRev: number, publishedHash: string | null) => {
	const bases = db().prepare('SELECT base_hash FROM versions WHERE path = ?').all(path) as { base_hash: string }[];
	const anchored = [publishedHash, ...bases.map((row) => row.base_hash)].filter((hash): hash is string => Boolean(hash));
	const placeholders = anchored.length ? anchored.map(() => '?').join(',') : "''";
	db()
		.prepare(`DELETE FROM revisions WHERE path = ? AND rev <= ? AND label IS NULL AND hash NOT IN (${placeholders})`)
		.run(path, headRev - revisionCap, ...anchored);
};

export const appendRevision = (path: string, frontmatter: string, body: string, hash: string, writer: string): number => {
	const now = new Date().toISOString();
	db().exec('BEGIN');
	try {
		const row = db().prepare('SELECT head_rev, published_hash, id FROM posts WHERE path = ?').get(path) as
			{
				head_rev: number | null;
				published_hash: string | null;
				id: string | null
			 } |
			undefined;

		const nextRev = (row?.head_rev ?? 0) + 1;
		const id = row?.id ?? newPostId();
		db()
			.prepare('INSERT INTO posts (path, head_rev, id) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET head_rev = ?, id = ?')
			.run(path, nextRev, id, nextRev, id);
		db()
			.prepare('INSERT INTO revisions (path, rev, hash, frontmatter, body, writer, saved_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
			.run(path, nextRev, hash, frontmatter, body, writer, now);
		pruneRevisions(path, nextRev, row?.published_hash ?? null);
		db().exec('COMMIT');
		return nextRev;
	} catch (caught) {
		db().exec('ROLLBACK');
		throw caught;
	}
};

const storedPostQuery = `
	SELECT posts.path, revisions.rev, revisions.hash, revisions.frontmatter, revisions.body,
		revisions.writer, revisions.saved_at, posts.published_hash, posts.exported_hash,
		posts.exported_mtime_ms, posts.llm_hash, posts.llm_mtime_ms, posts.id
	FROM posts JOIN revisions ON revisions.path = posts.path AND revisions.rev = posts.head_rev
	WHERE posts.head_rev IS NOT NULL`;

type StoredPostRow = {
	path: string;
	rev: number;
	hash: string;
	frontmatter: string;
	body: string;
	writer: string;
	saved_at: string;
	published_hash: string | null;
	exported_hash: string | null;
	exported_mtime_ms: number | null;
	llm_hash: string | null;
	llm_mtime_ms: number | null;
	id: string;
};

const toStoredPost = (row: StoredPostRow): StoredPost => ({
	path: row.path,
	rev: row.rev,
	hash: row.hash,
	frontmatter: row.frontmatter,
	body: row.body,
	writer: row.writer,
	savedAt: row.saved_at,
	publishedHash: row.published_hash,
	exportedHash: row.exported_hash,
	exportedMtimeMs: row.exported_mtime_ms,
	llmHash: row.llm_hash,
	llmMtimeMs: row.llm_mtime_ms,
	id: row.id
});

export const getStoredPost = (path: string): StoredPost | null => {
	const row = db().prepare(`${storedPostQuery} AND posts.path = ?`).get(path) as StoredPostRow | undefined;
	return row ? toStoredPost(row) : null;
};

export const listStoredPosts = (): StoredPost[] =>
	(db().prepare(storedPostQuery).all() as StoredPostRow[]).map(toStoredPost);

export const getRevisionByHash = (path: string, hash: string): { frontmatter: string; body: string } | null => {
	const row = db()
		.prepare('SELECT frontmatter, body FROM revisions WHERE path = ? AND hash = ? ORDER BY rev DESC LIMIT 1')
		.get(path, hash) as { frontmatter: string; body: string } | undefined;
	return row ?? null;
};

export const setExportedState = (path: string, hash: string | null, mtimeMs: number | null) => {
	db().prepare('UPDATE posts SET exported_hash = ?, exported_mtime_ms = ? WHERE path = ?').run(hash, mtimeMs, path);
};

export const setLlmState = (path: string, hash: string, mtimeMs: number) => {
	db().prepare('UPDATE posts SET llm_hash = ?, llm_mtime_ms = ? WHERE path = ?').run(hash, mtimeMs, path);
};

export const setStaged = (path: string, staged: boolean) => {
	db().prepare('UPDATE posts SET staged = ? WHERE path = ? AND head_rev IS NOT NULL').run(staged ? 1 : 0, path);
};

export const getStagedPaths = (): Set<string> =>
	new Set(
		(db().prepare('SELECT path FROM posts WHERE staged = 1').all() as { path: string }[]).map((row) => row.path)
	);

export const clearStaged = (paths: string[]) => {
	const clear = db().prepare('UPDATE posts SET staged = 0 WHERE path = ?');
	for (const path of paths) clear.run(path);
};

export const updatePublishedHash = (path: string, hash: string) => {
	db().prepare('UPDATE posts SET published_hash = ? WHERE path = ?').run(hash, path);
};

export const deletePostRows = (path: string) => {
	db().exec('BEGIN');
	db().prepare('DELETE FROM revisions WHERE path = ?').run(path);
	db().prepare('DELETE FROM versions WHERE path = ?').run(path);
	db().prepare('DELETE FROM posts WHERE path = ?').run(path);
	db().exec('COMMIT');
};

export const getMetaValue = (key: string) => getMeta(key);
export const setMetaValue = (key: string, value: string) => setMeta(key, value);

export const listMetaKeys = (prefix: string): string[] =>
	(db().prepare('SELECT key FROM meta WHERE substr(key, 1, ?) = ?').all(prefix.length, prefix) as { key: string }[]).map(
		(row) => row.key
	);

export const vacuumInto = (targetPath: string) => {
	db().exec(`VACUUM INTO '${targetPath.replaceAll("'", "''")}'`);
};

export const getRevision = (path: string, rev: number): { hash: string; frontmatter: string; body: string } | null => {
	const row = db()
		.prepare('SELECT hash, frontmatter, body FROM revisions WHERE path = ? AND rev = ?')
		.get(path, rev) as { hash: string; frontmatter: string; body: string } | undefined;
	return row ?? null;
};

export type RevisionEntry = { rev: number; hash: string; writer: string; savedAt: string; label: string | null };

const revisionListLimit = 500;

export const listRevisions = (path: string): RevisionEntry[] =>
	(
		db()
			.prepare('SELECT rev, hash, writer, saved_at, label FROM revisions WHERE path = ? ORDER BY rev DESC LIMIT ?')
			.all(path, revisionListLimit) as { rev: number; hash: string; writer: string; saved_at: string; label: string | null }[]
	).map((row) => ({ rev: row.rev, hash: row.hash, writer: row.writer, savedAt: row.saved_at, label: row.label }));

export const labelRevision = (path: string, rev: number, label: string | null) => {
	const result = db().prepare('UPDATE revisions SET label = ? WHERE path = ? AND rev = ?').run(label, path, rev);
	return result.changes > 0;
};
