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
const metadataByteLimit = 4096;

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
	path: string | null;
	frontmatter: string | null;
	rev: number;
	hash: string | null;
	writer: string | null;
	saved_at: string | null;
	published_hash: string | null;
	published_title: string | null;
	published_slug: string | null;
	published_commit: string | null;
	published_at: string | null;
	staged: number | null;
	editing_order: number | null;
	published: number;
	metadata_oversized: number;
};

type VersionRow = {
	writer: string | null;
	sessionId: string | null;
	baseHash: string | null;
	updatedAt: string | null;
	metadataOversized: number;
};

const boundedColumn = (column: string, alias = column.split('.')[1]) =>
	`CASE WHEN octet_length(${column}) <= ${metadataByteLimit} THEN ${column} END AS ${alias}`;

const metadataColumns = ['p.path', 'r.hash', 'r.writer', 'r.saved_at', 'p.published_hash',
	'p.published_title', 'p.published_slug', 'p.published_commit', 'p.published_at'];

const postQuery = `
	SELECT p.id, r.rev, ${metadataColumns.map((column) => boundedColumn(column)).join(', ')},
		CASE WHEN octet_length(r.frontmatter) <= ${frontmatterByteLimit}
			THEN r.frontmatter END AS frontmatter,
		(${metadataColumns.map((column) => `coalesce(octet_length(${column}), 0) > ${metadataByteLimit}`).join(' OR ')})
			AS metadata_oversized,
		p.published_hash IS NOT NULL AS published,
		p.staged, p.editing_order
	FROM posts p JOIN revisions r ON r.path = p.path AND r.rev = p.head_rev`;

const readVersions = (database: DatabaseSync, id: string): VersionRow[] => database.prepare(`
	SELECT ${boundedColumn('v.writer')}, ${boundedColumn('v.session_id', 'sessionId')},
		${boundedColumn('v.base_hash', 'baseHash')}, ${boundedColumn('v.updated_at', 'updatedAt')},
		max(octet_length(v.writer), octet_length(v.session_id), octet_length(v.base_hash),
			octet_length(v.updated_at)) > ${metadataByteLimit} AS metadataOversized
	FROM versions v JOIN posts p ON p.path = v.path WHERE p.id = ? ORDER BY v.writer LIMIT ?
`).all(id, versionLimit + 1) as VersionRow[];

const summarize = (row: PostRow, versions: VersionRow[]) => {
	const fields = row.frontmatter === null ? null : parseFrontmatter(row.frontmatter);
	const publish = row.frontmatter === null ? null : readBoolean(row.frontmatter, 'publish');
	const deleteRequested = row.frontmatter === null ? null :
		readBoolean(row.frontmatter, 'delete') || readBoolean(row.frontmatter, 'deleted');
	const fallbackTitle = row.path?.replace(/\.md$/, '').split('/').at(-1)?.replaceAll('-', ' ') ?? null;
	const publication = row.published === 0 ? null : {
		hash: row.published_hash,
		title: row.published_title,
		slug: row.published_slug,
		commit: row.published_commit,
		publishedAt: row.published_at
	};
	return {
		id: row.id,
		path: row.path,
		title: row.frontmatter === null ? null : readFrontmatterValue(row.frontmatter, 'title') || fallbackTitle,
		slug: row.path === null || row.frontmatter === null ? null : svxSlug(row.path, row.frontmatter),
		date: fields?.date ?? null,
		tags: fields?.tags ?? null,
		publish,
		deleteRequested,
		deployStatus: publish === null || deleteRequested === null || row.hash === null ||
			(publication !== null && publication.hash === null) ? null :
			getDeployStatus({ publish, deleteRequested, contentHash: row.hash },
				publication ? { hash: publication.hash! } : undefined),
		publication,
		staged: row.staged === 1,
		editingOrder: row.editing_order,
		head: { rev: row.rev, contentHash: row.hash, writer: row.writer, savedAt: row.saved_at },
		hasVersions: versions.length > 0,
		oversized: {
			frontmatter: row.frontmatter === null,
			metadata: row.metadata_oversized === 1 || versions.some((version) => version.metadataOversized === 1),
			versions: versions.length > versionLimit
		},
		versions: versions.slice(0, versionLimit).map((version) => ({
			...version, metadataOversized: version.metadataOversized === 1
		}))
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
			posts: page.map((row) => summarize(row, readVersions(database, row.id))),
			nextCursor: rows.length > limit ? page.at(-1)!.id : null
		};
	});
};

export const getInventoryPost = (id: string) => {
	assert(isPostId(id));
	return readInventory((database) => {
		const row = database.prepare(`${postQuery} WHERE p.id = ?`).get(id) as PostRow | undefined;
		if (!row) throw error(404, 'Unknown inventory post');
		const versions = readVersions(database, row.id);
		const summary = summarize(row, versions);
		if (Object.values(summary.oversized).some(Boolean)) {
			throw error(413, 'Post exceeds inventory metadata or version limits; use its bounded list summary');
		}
		const sizes = database.prepare(`
			SELECT octet_length(frontmatter) + octet_length(body) AS bytes
			FROM revisions r JOIN posts p ON p.path = r.path AND p.head_rev = r.rev WHERE p.id = ?
			UNION ALL
			SELECT octet_length(frontmatter) + octet_length(body) AS bytes
			FROM versions v JOIN posts p ON p.path = v.path WHERE p.id = ? LIMIT ?
		`).all(id, id, versionLimit + 1) as { bytes: number }[];
		if (sizes.reduce((total, item) => total + item.bytes, 0) > detailByteLimit) {
			throw error(413, 'Post exceeds the 1 MiB inventory detail limit');
		}
		const head = database.prepare(`SELECT r.frontmatter, r.body FROM revisions r
			JOIN posts p ON p.path = r.path AND p.head_rev = r.rev WHERE p.id = ?`)
			.get(id) as { frontmatter: string; body: string };
		const content = database.prepare(`
			SELECT v.frontmatter, v.body FROM versions v JOIN posts p ON p.path = v.path
			WHERE p.id = ? ORDER BY v.writer LIMIT ?
		`).all(id, versionLimit) as { frontmatter: string; body: string }[];
		return {
			...summary,
			head: { ...summary.head, ...head },
			versions: summary.versions.map((version, index) => ({
				...version,
				frontmatter: content[index].frontmatter,
				body: content[index].body,
				contentHash: hashPostContent(content[index].frontmatter, content[index].body)
			}))
		};
	});
};
