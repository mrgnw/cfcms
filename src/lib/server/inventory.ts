import { error, isHttpError } from '@sveltejs/kit';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { getDeployStatus } from '#lib/deploy-status.js';
import { parseFrontmatter, readBoolean, readFrontmatterValue } from '#lib/frontmatter.js';
import { isPostId } from '#lib/post-id.js';
import { hashPostContent } from '#lib/post-text.js';
import { svxSlug } from '#lib/svx.js';
import { databasePath } from './paths';

export const inventoryPageLimit = 100;
const frontmatterByteLimit = 64 * 1024;
const detailByteLimit = 1024 * 1024;
const versionLimit = 10;

const readInventory = <T>(read: (database: DatabaseSync) => T): T => {
	let database: DatabaseSync | undefined;
	try {
		database = new DatabaseSync(databasePath, { readOnly: true, timeout: 100 });
		database.exec('PRAGMA query_only = ON; BEGIN');
		return read(database);
	} catch (caught) {
		if (isHttpError(caught)) throw caught;
		throw error(503, 'Inventory requires an available, initialized CMS database');
	} finally {
		database?.close();
	}
};

type PostRow = {
	id: string;
	path: string;
	frontmatter: string | null;
	rev: number;
	hash: string;
	writer: string;
	saved_at: string;
	published_hash: string | null;
	published_title: string | null;
	published_slug: string | null;
	published_commit: string | null;
	published_at: string | null;
	staged: number | null;
	editing_order: number | null;
};

type VersionRow = {
	writer: string;
	sessionId: string;
	baseHash: string;
	updatedAt: string;
};

const postQuery = `
	SELECT p.id, p.path, r.rev, r.hash, r.writer, r.saved_at,
		CASE WHEN octet_length(r.frontmatter) <= ${frontmatterByteLimit}
			THEN r.frontmatter END AS frontmatter,
		p.published_hash, p.published_title, p.published_slug, p.published_commit, p.published_at,
		p.staged, p.editing_order
	FROM posts p JOIN revisions r ON r.path = p.path AND r.rev = p.head_rev`;

const readVersions = (database: DatabaseSync, path: string): VersionRow[] => {
	const versions = database.prepare(`
		SELECT writer, session_id AS sessionId, base_hash AS baseHash, updated_at AS updatedAt
		FROM versions WHERE path = ? ORDER BY writer LIMIT ?
	`).all(path, versionLimit + 1) as VersionRow[];
	if (versions.length > versionLimit) throw error(413, 'Post exceeds the inventory limit of 10 versions');
	return versions;
};

const summarize = (row: PostRow, versions: VersionRow[]) => {
	if (row.frontmatter === null) throw error(413, `Post ${row.id} exceeds the 64 KiB frontmatter limit`);
	const fields = parseFrontmatter(row.frontmatter);
	const publish = readBoolean(row.frontmatter, 'publish');
	const deleteRequested = readBoolean(row.frontmatter, 'delete') || readBoolean(row.frontmatter, 'deleted');
	const fallbackTitle = row.path.replace(/\.md$/, '').split('/').at(-1)?.replaceAll('-', ' ') || 'Untitled';
	const publication = row.published_hash === null ? null : {
		hash: row.published_hash,
		title: row.published_title,
		slug: row.published_slug,
		commit: row.published_commit,
		publishedAt: row.published_at
	};
	return {
		id: row.id,
		path: row.path,
		title: readFrontmatterValue(row.frontmatter, 'title') || fallbackTitle,
		slug: svxSlug(row.path, row.frontmatter),
		date: fields.date,
		tags: fields.tags,
		publish,
		deleteRequested,
		deployStatus: getDeployStatus({ publish, deleteRequested, contentHash: row.hash }, publication ?? undefined),
		publication,
		staged: row.staged === 1,
		editingOrder: row.editing_order,
		human: { rev: row.rev, contentHash: row.hash, writer: row.writer, savedAt: row.saved_at },
		hasAssistantDraft: versions.some((version) => /^llm\d*$/.test(version.writer)),
		versions
	};
};

export const listInventory = (limit: number, after: string | null) => {
	assert(Number.isInteger(limit) && limit > 0 && limit <= inventoryPageLimit);
	assert(after === null || isPostId(after));
	return readInventory((database) => {
		const rows = database.prepare(`${postQuery} WHERE p.id > ? ORDER BY p.id LIMIT ?`)
			.all(after ?? '', limit + 1) as PostRow[];
		const page = rows.slice(0, limit);
		return {
			posts: page.map((row) => summarize(row, readVersions(database, row.path))),
			nextCursor: rows.length > limit ? page.at(-1)!.id : null
		};
	});
};

export const getInventoryPost = (id: string) => {
	assert(isPostId(id));
	return readInventory((database) => {
		const row = database.prepare(`${postQuery} WHERE p.id = ?`).get(id) as PostRow | undefined;
		if (!row) throw error(404, 'Unknown inventory post');
		const versions = readVersions(database, row.path);
		const summary = summarize(row, versions);
		const sizes = database.prepare(`
			SELECT octet_length(frontmatter) + octet_length(body) AS bytes
			FROM revisions WHERE path = ? AND rev = ?
			UNION ALL
			SELECT octet_length(frontmatter) + octet_length(body) AS bytes
			FROM versions WHERE path = ? LIMIT ?
		`).all(row.path, row.rev, row.path, versionLimit + 1) as { bytes: number }[];
		if (sizes.reduce((total, item) => total + item.bytes, 0) > detailByteLimit) {
			throw error(413, 'Post exceeds the 1 MiB inventory detail limit');
		}
		const human = database.prepare('SELECT frontmatter, body FROM revisions WHERE path = ? AND rev = ?')
			.get(row.path, row.rev) as { frontmatter: string; body: string };
		const content = database.prepare(`
			SELECT writer, frontmatter, body FROM versions WHERE path = ? ORDER BY writer LIMIT ?
		`).all(row.path, versionLimit) as { writer: string; frontmatter: string; body: string }[];
		return {
			...summary,
			human: { ...summary.human, ...human },
			versions: versions.map((version, index) => ({
				...version,
				frontmatter: content[index].frontmatter,
				body: content[index].body,
				contentHash: hashPostContent(content[index].frontmatter, content[index].body)
			}))
		};
	});
};
