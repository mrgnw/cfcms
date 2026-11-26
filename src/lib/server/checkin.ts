// Merges an offline copy's database back into the mini's, with the checkout snapshot as common ancestor.
// Plain node imports only: scripts/checkin loads this file without the SvelteKit alias hooks.
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { randomPostId } from '../post-id.ts';

export type CheckinDatabases = { base: DatabaseSync; offline: DatabaseSync; mini: DatabaseSync };

type Head = { id: string; path: string; headRev: number; hash: string; savedAt: string };

export type CheckinAction =
	| { kind: 'fast-forward'; id: string; path: string; fromRev: number; revisions: number }
	| { kind: 'conflict'; id: string; path: string; writer: string }
	| { kind: 'create'; id: string; path: string; offlineId: string; offlinePath: string; revisions: number }
	| { kind: 'version'; path: string; writer: string; offlinePath: string; offlineWriter: string };

export type CheckinPlan = { actions: CheckinAction[]; skipped: string[] };

const mergedTables = ['posts', 'revisions', 'versions', 'meta'];
const versionWriterLimit = 10;
const maxIdAttempts = 8;
const maxPathAttempts = 100;

const columnsOf = (db: DatabaseSync, table: string) =>
	(db.prepare(`SELECT name, type, pk FROM pragma_table_info(?) ORDER BY name`).all(table) as {
		name: string; type: string; pk: number;
	}[]).map((column) => `${column.name} ${column.type}${column.pk ? ' pk' : ''}`).join(', ');

export const assertSameSchema = (dbs: CheckinDatabases) => {
	for (const table of mergedTables) {
		const base = columnsOf(dbs.base, table);
		if (!base) throw new Error(`Schema mismatch: base has no ${table} table`);
		for (const side of ['offline', 'mini'] as const) {
			const other = columnsOf(dbs[side], table);
			if (other !== base) throw new Error(`Schema mismatch in ${table}:\n  base:    ${base}\n  ${`${side}:`.padEnd(8)} ${other}`);
		}
	}
};

const headsById = (db: DatabaseSync): Map<string, Head> => {
	const rows = db.prepare(`
		SELECT posts.id, posts.path, posts.head_rev AS headRev, revisions.hash, revisions.saved_at AS savedAt
		FROM posts JOIN revisions ON revisions.path = posts.path AND revisions.rev = posts.head_rev
		WHERE posts.head_rev IS NOT NULL
	`).all() as Head[];
	for (const row of rows) if (!row.id) throw new Error(`Post ${row.path} has a head but no id`);
	return new Map(rows.map((row) => [row.id, row]));
};

const assertDescendsFrom = (side: string, heads: Map<string, Head>, baseHeads: Map<string, Head>) => {
	for (const [id, base] of baseHeads) {
		const head = heads.get(id);
		if (head && (head.headRev < base.headRev || head.path !== base.path)) {
			throw new Error(`${side} does not descend from checkout-base.db: ${base.path} is at rev ${head.headRev}, base at ${base.headRev}`);
		}
	}
};

const freeWriter = (taken: Set<string>, path: string, writer: string) => {
	for (let attempt = 0; attempt < versionWriterLimit; attempt += 1) {
		const label = attempt === 0 ? writer : `${writer}${attempt + 1}`;
		if (!taken.has(`${path}\n${label}`)) {
			taken.add(`${path}\n${label}`);
			return label;
		}
	}
	throw new Error(`No free version label for ${writer} on ${path}`);
};

const freePath = (taken: Set<string>, path: string) => {
	const stem = path.replace(/\.md$/, '');
	for (let attempt = 1; attempt <= maxPathAttempts; attempt += 1) {
		const candidate = attempt === 1 ? path : `${stem}-${attempt}.md`;
		if (!taken.has(candidate)) {
			taken.add(candidate);
			return candidate;
		}
	}
	throw new Error(`No free path for ${path}`);
};

const freeId = (taken: Set<string>, id: string) => {
	if (!taken.has(id)) return id;
	for (let attempt = 0; attempt < maxIdAttempts; attempt += 1) {
		const candidate = randomPostId();
		if (!taken.has(candidate)) return candidate;
	}
	throw new Error(`No free post id after ${maxIdAttempts} attempts`);
};

const headText = (db: DatabaseSync, id: string) => db.prepare(`
	SELECT revisions.hash, revisions.frontmatter, revisions.body FROM posts
	JOIN revisions ON revisions.path = posts.path AND revisions.rev = posts.head_rev WHERE posts.id = ?
`).get(id) as { hash: string; frontmatter: string; body: string };

const hasVersionText = (dbs: CheckinDatabases, id: string, path: string) => {
	const offline = headText(dbs.offline, id);
	return Boolean(dbs.mini.prepare('SELECT 1 FROM versions WHERE path = ? AND frontmatter = ? AND body = ?')
		.get(path, offline.frontmatter, offline.body));
};

const revisionCount = (db: DatabaseSync, path: string, afterRev: number) =>
	(db.prepare('SELECT count(*) AS count FROM revisions WHERE path = ? AND rev > ?').get(path, afterRev) as { count: number }).count;

const planCheckin = (dbs: CheckinDatabases): CheckinPlan => {
	assertSameSchema(dbs);
	const base = headsById(dbs.base);
	const offline = headsById(dbs.offline);
	const mini = headsById(dbs.mini);
	assertDescendsFrom('offline', offline, base);
	assertDescendsFrom('mini', mini, base);

	const takenPaths = new Set((dbs.mini.prepare('SELECT path FROM posts').all() as { path: string }[]).map((row) => row.path));
	const takenIds = new Set([...mini.keys()]);
	const takenWriters = new Set((dbs.mini.prepare('SELECT path, writer FROM versions').all() as {
		path: string; writer: string;
	}[]).map((row) => `${row.path}\n${row.writer}`));
	const miniHashes = new Map([...mini.values()].map((head) => [head.hash, head.path]));
	const miniPathFor = new Map<string, string>();
	const actions: CheckinAction[] = [];
	const skipped: string[] = [];

	for (const head of offline.values()) {
		const ancestor = base.get(head.id);
		const current = mini.get(head.id);
		if (ancestor && head.hash === ancestor.hash) continue;

		const twin = ancestor ? undefined : miniHashes.get(head.hash);
		if (twin) {
			skipped.push(`${head.path}: already checked in as ${twin}`);
			continue;
		}
		if (!ancestor || !current) {
			const id = freeId(takenIds, head.id);
			takenIds.add(id);
			const path = freePath(takenPaths, head.path);
			miniPathFor.set(head.path, path);
			actions.push({ kind: 'create', id, path, offlineId: head.id, offlinePath: head.path, revisions: revisionCount(dbs.offline, head.path, 0) });
			continue;
		}
		miniPathFor.set(head.path, current.path);
		if (current.hash === head.hash) {
			skipped.push(`${current.path}: same text on both sides`);
		} else if (current.hash === ancestor.hash) {
			actions.push({
				kind: 'fast-forward', id: head.id, path: current.path, fromRev: ancestor.headRev,
				revisions: revisionCount(dbs.offline, head.path, ancestor.headRev)
			});
		} else if (hasVersionText(dbs, head.id, current.path)) {
			skipped.push(`${current.path}: offline head is already a pending version`);
		} else {
			actions.push({ kind: 'conflict', id: head.id, path: current.path, writer: freeWriter(takenWriters, current.path, 'offline') });
		}
	}

	const knownRevisions = new Set([dbs.base, dbs.mini].flatMap((db) =>
		(db.prepare('SELECT revision FROM versions').all() as { revision: string }[]).map((row) => row.revision)));
	const offlineVersions = dbs.offline.prepare('SELECT path, writer, revision FROM versions ORDER BY path, writer').all() as {
		path: string; writer: string; revision: string;
	}[];
	for (const version of offlineVersions) {
		if (knownRevisions.has(version.revision)) continue;
		const path = miniPathFor.get(version.path) ?? (takenPaths.has(version.path) ? version.path : null);
		if (!path) {
			skipped.push(`${version.path} (${version.writer}): pending version for a post the mini does not have`);
			continue;
		}
		actions.push({ kind: 'version', path, writer: freeWriter(takenWriters, path, version.writer), offlinePath: version.path, offlineWriter: version.writer });
	}
	for (const [id, ancestor] of base) {
		if (!offline.has(id)) skipped.push(`${ancestor.path}: deleted offline, left as is on the mini`);
	}
	return { actions, skipped };
};

const describe = (action: CheckinAction) => {
	switch (action.kind) {
		case 'fast-forward': return `fast-forward  ${action.path}: ${action.revisions} offline revision(s) become the head`;
		case 'conflict': return `conflict      ${action.path}: both sides changed, offline head becomes pending version "${action.writer}"`;
		case 'create': {
			const renamed = action.path === action.offlinePath ? '' : ` as ${action.path}`;
			const reid = action.id === action.offlineId ? '' : `, id ${action.offlineId} -> ${action.id}`;
			return `create        ${action.offlinePath}${renamed} (id ${action.id}${reid}, ${action.revisions} revision(s))`;
		}
		case 'version': return `version       ${action.path}: offline pending version "${action.offlineWriter}" kept as "${action.writer}"`;
	}
};

export const formatPlan = (plan: CheckinPlan) => {
	const lines = plan.actions.map(describe);
	if (!lines.length) lines.push('nothing to merge');
	for (const note of plan.skipped) lines.push(`skip          ${note}`);
	return lines.join('\n');
};

type RevisionRow = { hash: string; frontmatter: string; body: string; writer: string; saved_at: string; label: string | null };

const offlineRevisions = (offline: DatabaseSync, path: string, afterRev: number) =>
	offline.prepare('SELECT hash, frontmatter, body, writer, saved_at, label FROM revisions WHERE path = ? AND rev > ? ORDER BY rev')
		.all(path, afterRev) as RevisionRow[];

const appendRevisions = (mini: DatabaseSync, path: string, startRev: number, revisions: RevisionRow[]) => {
	const insert = mini.prepare(
		'INSERT INTO revisions (path, rev, hash, frontmatter, body, writer, saved_at, label) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
	);
	for (const [index, revision] of revisions.entries()) {
		insert.run(path, startRev + index, revision.hash, revision.frontmatter, revision.body, revision.writer, revision.saved_at, revision.label);
	}
	return startRev + revisions.length - 1;
};

type VersionRow = { path: string; writer: string; sessionId: string; baseHash: string; frontmatter: string; body: string; revision: string };

const insertVersion = (mini: DatabaseSync, version: VersionRow) => {
	mini.prepare(`
		INSERT INTO versions (path, writer, session_id, base_hash, frontmatter, body, updated_at, revision)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`).run(version.path, version.writer, version.sessionId, version.baseHash, version.frontmatter, version.body, new Date().toISOString(), version.revision);
};

const fastForward = (dbs: CheckinDatabases, action: Extract<CheckinAction, { kind: 'fast-forward' }>) => {
	const offlinePath = (dbs.offline.prepare('SELECT path FROM posts WHERE id = ?').get(action.id) as { path: string }).path;
	const { head_rev: miniRev } = dbs.mini.prepare('SELECT head_rev FROM posts WHERE id = ?').get(action.id) as { head_rev: number };
	const revisions = offlineRevisions(dbs.offline, offlinePath, action.fromRev);
	if (!revisions.length) throw new Error(`Offline revisions after rev ${action.fromRev} of ${offlinePath} are gone`);
	const headRev = appendRevisions(dbs.mini, action.path, miniRev + 1, revisions);
	dbs.mini.prepare('UPDATE posts SET head_rev = ? WHERE id = ?').run(headRev, action.id);
};

const conflict = (dbs: CheckinDatabases, action: Extract<CheckinAction, { kind: 'conflict' }>) => {
	const offline = headText(dbs.offline, action.id);
	insertVersion(dbs.mini, {
		path: action.path, writer: action.writer, sessionId: 'checkin', baseHash: headText(dbs.base, action.id).hash,
		frontmatter: offline.frontmatter, body: offline.body, revision: randomUUID()
	});
};

const create = (dbs: CheckinDatabases, action: Extract<CheckinAction, { kind: 'create' }>) => {
	const row = dbs.offline.prepare('SELECT * FROM posts WHERE path = ?').get(action.offlinePath) as Record<string, unknown>;
	const { next } = dbs.mini.prepare('SELECT COALESCE(MAX(editing_order), -1) + 1 AS next FROM posts').get() as { next: number };
	const cleared = ['published_hash', 'published_title', 'published_slug', 'published_commit', 'published_at', 'exported_hash',
		'exported_mtime_ms', 'llm_hash', 'llm_mtime_ms', 'llm_version_revision', 'staged', 'staged_hash'];
	const post: Record<string, unknown> = { ...row, path: action.path, id: action.id };
	for (const column of cleared) post[column] = null;
	if (row.editing_order !== null) post.editing_order = next;
	const columns = Object.keys(post);
	dbs.mini.prepare(`INSERT INTO posts (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
		.run(...(columns.map((column) => post[column]) as (string | number | null)[]));

	const revisions = dbs.offline.prepare('SELECT rev, hash, frontmatter, body, writer, saved_at, label FROM revisions WHERE path = ? ORDER BY rev')
		.all(action.offlinePath) as (RevisionRow & { rev: number })[];
	const insert = dbs.mini.prepare(
		'INSERT INTO revisions (path, rev, hash, frontmatter, body, writer, saved_at, label) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
	);
	for (const revision of revisions) {
		insert.run(action.path, revision.rev, revision.hash, revision.frontmatter, revision.body, revision.writer, revision.saved_at, revision.label);
	}
};

const version = (dbs: CheckinDatabases, action: Extract<CheckinAction, { kind: 'version' }>) => {
	const row = dbs.offline.prepare('SELECT session_id, base_hash, frontmatter, body, revision FROM versions WHERE path = ? AND writer = ?')
		.get(action.offlinePath, action.offlineWriter) as { session_id: string; base_hash: string; frontmatter: string; body: string; revision: string };
	insertVersion(dbs.mini, {
		path: action.path, writer: action.writer, sessionId: row.session_id, baseHash: row.base_hash,
		frontmatter: row.frontmatter, body: row.body, revision: row.revision
	});
};

const applyPlan = (dbs: CheckinDatabases, plan: CheckinPlan) => {
	for (const action of plan.actions) {
		if (action.kind === 'fast-forward') fastForward(dbs, action);
		if (action.kind === 'conflict') conflict(dbs, action);
		if (action.kind === 'create') create(dbs, action);
		if (action.kind === 'version') version(dbs, action);
	}
};

export type CheckinOptions = { apply: boolean; backup?: () => void };

// Plans and applies under one write lock on the mini, so nothing can land between the two.
// backup runs once the lock is held and before the first write; a second connection can still read.
export const runCheckin = (dbs: CheckinDatabases, options: CheckinOptions): CheckinPlan => {
	dbs.mini.exec(options.apply ? 'BEGIN IMMEDIATE' : 'BEGIN');
	try {
		const plan = planCheckin(dbs);
		if (!options.apply) {
			dbs.mini.exec('ROLLBACK');
			return plan;
		}
		options.backup?.();
		applyPlan(dbs, plan);
		dbs.mini.exec('COMMIT');
		return plan;
	} catch (caught) {
		if (dbs.mini.isTransaction) dbs.mini.exec('ROLLBACK');
		throw caught;
	}
};
