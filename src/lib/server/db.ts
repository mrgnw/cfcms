import { env } from '$env/dynamic/private';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { contentBaseDirectory } from './paths';

// Lazy init: opening at module load would run during `vite build` with
// build-time cwd/env and poison the db with a wrong-path legacy import.
let instance: DatabaseSync | null = null;

const db = () => {
	if (instance) return instance;

	const databasePath = resolve(env.BLOG_CMS_DB ?? resolve(process.cwd(), '.data/cms.db'));
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
	`);
	importLegacyDeployState();
	return instance;
};

const getMeta = (key: string): string | null => {
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

	const legacyDeployStatePath = resolve(
		env.BLOG_CMS_DEPLOY_STATE_FILE ?? resolve(contentBaseDirectory, '.cms/deploy-state.json')
	);

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
	db().prepare('DELETE FROM posts WHERE published_hash IS NULL AND editing_order IS NULL').run();
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
	db().prepare('DELETE FROM posts WHERE published_hash IS NULL AND editing_order IS NULL').run();
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

export const pruneMissingPosts = (existingPaths: Set<string>) => {
	const rows = db().prepare('SELECT path FROM posts').all() as { path: string }[];
	const remove = db().prepare('DELETE FROM posts WHERE path = ?');

	db().exec('BEGIN');
	for (const row of rows) {
		if (!existingPaths.has(row.path)) remove.run(row.path);
	}
	db().exec('COMMIT');
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
