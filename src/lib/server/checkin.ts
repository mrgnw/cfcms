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
	| { kind: 'version'; id: string; path: string; writer: string; offlinePath: string; offlineWriter: string };

// fastPath: the mini has not changed since checkout, so the offline content replaces it and the
// actions are only a report of what that brings.
export type CheckinPlan = { fastPath: boolean; actions: CheckinAction[]; skipped: string[] };

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

// Revisions are append-only, so a side changed a post exactly when its head is no longer the base's head
// revision. Comparing text instead misses edits that return to the base text and drops their history.
const changedSince = (head: Head, base: Head) => head.headRev !== base.headRev || head.savedAt !== base.savedAt;

const assertDescendsFrom = (side: string, db: DatabaseSync, heads: Map<string, Head>, baseHeads: Map<string, Head>) => {
	const revisionAt = db.prepare('SELECT hash, saved_at AS savedAt FROM revisions WHERE path = ? AND rev = ?');
	for (const [id, base] of baseHeads) {
		const head = heads.get(id);
		if (!head) continue;
		// a base head pruned since (200 newer autosaves) cannot be compared; rev order still holds
		const kept = revisionAt.get(base.path, base.headRev) as { hash: string; savedAt: string } | undefined;
		const diverged = kept !== undefined && (kept.hash !== base.hash || kept.savedAt !== base.savedAt);
		if (head.headRev < base.headRev || head.path !== base.path || diverged) {
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

const revisionCount = (db: DatabaseSync, path: string, afterRev: number) =>
	(db.prepare('SELECT count(*) AS count FROM revisions WHERE path = ? AND rev > ?').get(path, afterRev) as { count: number }).count;

const contentTables = [['posts', 'path'], ['revisions', 'path, rev'], ['versions', 'path, writer']] as const;

const contentRows = (db: DatabaseSync, table: string, order: string) =>
	db.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all() as Record<string, string | number | null>[];

// ponytail: compares whole tables in memory; fine for one writer's blog (a few MB), stream it if that grows
const unchangedSince = (db: DatabaseSync, base: DatabaseSync) => contentTables.every(([table, order]) =>
	JSON.stringify(contentRows(db, table, order)) === JSON.stringify(contentRows(base, table, order)));

const preservesBase = (offline: DatabaseSync, base: DatabaseSync) => contentTables.every(([table, order]) => {
	const keys = order.split(', ');
	const key = (row: Record<string, string | number | null>) => JSON.stringify(keys.map((column) => row[column]));
	const rows = new Map(contentRows(offline, table, order).map((row) => [key(row), row]));
	return contentRows(base, table, order).every((row) => {
		const other = rows.get(key(row));
		return other !== undefined && (table === 'posts' || JSON.stringify(row) === JSON.stringify(other));
	});
});

const replaceContent = (dbs: CheckinDatabases) => {
	for (const [table, order] of contentTables) {
		dbs.mini.exec(`DELETE FROM ${table}`);
		for (const row of contentRows(dbs.offline, table, order)) {
			const columns = Object.keys(row);
			dbs.mini.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
				.run(...columns.map((column) => row[column]));
		}
	}
};

const planCheckin = (dbs: CheckinDatabases): CheckinPlan => {
	assertSameSchema(dbs);
	const base = headsById(dbs.base);
	const offline = headsById(dbs.offline);
	const mini = headsById(dbs.mini);
	assertDescendsFrom('offline', dbs.offline, offline, base);
	assertDescendsFrom('mini', dbs.mini, mini, base);

	const takenPaths = new Set((dbs.mini.prepare('SELECT path FROM posts').all() as { path: string }[]).map((row) => row.path));
	const takenIds = new Set([...mini.keys()]);
	const takenWriters = new Set((dbs.mini.prepare('SELECT path, writer FROM versions').all() as {
		path: string; writer: string;
	}[]).map((row) => `${row.path}\n${row.writer}`));
	// every offline post id -> the mini post it lands on; all references (revisions, versions) go through it
	const miniPostFor = new Map<string, { id: string; path: string }>();
	const actions: CheckinAction[] = [];
	const skipped: string[] = [];
	const knownRevisions = new Set([dbs.base, dbs.mini].flatMap((db) =>
		(db.prepare('SELECT revision FROM versions').all() as { revision: string }[]).map((row) => row.revision)));
	const pendingAt = dbs.offline.prepare('SELECT revision FROM versions WHERE path = ?');

	for (const head of offline.values()) {
		const ancestor = base.get(head.id);
		const current = mini.get(head.id);
		if (ancestor && !changedSince(head, ancestor)) {
			if (current) {
				miniPostFor.set(head.id, { id: current.id, path: current.path });
				continue;
			}
			const pending = pendingAt.all(head.path) as { revision: string }[];
			if (!pending.some((version) => !knownRevisions.has(version.revision))) continue;
		}

		if (!ancestor || !current) {
			const id = freeId(takenIds, head.id);
			takenIds.add(id);
			const path = freePath(takenPaths, head.path);
			miniPostFor.set(head.id, { id, path });
			actions.push({ kind: 'create', id, path, offlineId: head.id, offlinePath: head.path, revisions: revisionCount(dbs.offline, head.path, 0) });
			continue;
		}
		miniPostFor.set(head.id, { id: current.id, path: current.path });
		if (!changedSince(current, ancestor)) {
			actions.push({
				kind: 'fast-forward', id: head.id, path: current.path, fromRev: ancestor.headRev,
				revisions: revisionCount(dbs.offline, head.path, ancestor.headRev)
			});
		} else {
			actions.push({ kind: 'conflict', id: head.id, path: current.path, writer: freeWriter(takenWriters, current.path, 'offline') });
		}
	}

	const offlineVersions = dbs.offline.prepare(`
		SELECT versions.path, versions.writer, versions.revision, posts.id FROM versions
		LEFT JOIN posts ON posts.path = versions.path ORDER BY versions.path, versions.writer
	`).all() as { path: string; writer: string; revision: string; id: string | null }[];
	for (const version of offlineVersions) {
		if (knownRevisions.has(version.revision)) continue;
		const target = version.id ? miniPostFor.get(version.id) : undefined;
		if (!target) {
			skipped.push(`${version.path} (${version.writer}): pending version for a post the mini does not have`);
			continue;
		}
		actions.push({
			kind: 'version', id: target.id, path: target.path, writer: freeWriter(takenWriters, target.path, version.writer),
			offlinePath: version.path, offlineWriter: version.writer
		});
	}
	for (const [id, ancestor] of base) {
		if (!offline.has(id)) skipped.push(`${ancestor.path}: deleted offline, left as is on the mini`);
	}
	return { fastPath: unchangedSince(dbs.mini, dbs.base) && preservesBase(dbs.offline, dbs.base), actions, skipped };
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
	if (plan.fastPath) {
		lines.unshift('fast path: the mini has not changed since checkout, so the offline posts, revisions and versions replace it');
	}
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

// checkoutId names one checkout (the scripts use the sha256 of checkout-base.db); applying it twice is refused.
export type CheckinOptions = { apply: boolean; checkoutId: string; backup?: () => void };

const checkinKey = (checkoutId: string) => `checkin:${checkoutId}`;

const assertNotCheckedIn = (mini: DatabaseSync, checkoutId: string) => {
	const row = mini.prepare('SELECT value FROM meta WHERE key = ?').get(checkinKey(checkoutId)) as { value: string } | undefined;
	if (row) throw new Error(`This checkout was already checked in (${row.value}). Make a new copy with scripts/checkout.`);
};

// Plans and applies under one write lock on the mini, so nothing can land between the two.
// backup runs once the lock is held and before the first write; a second connection can still read.
export const runCheckin = (dbs: CheckinDatabases, options: CheckinOptions): CheckinPlan => {
	dbs.mini.exec(options.apply ? 'BEGIN IMMEDIATE' : 'BEGIN');
	try {
		if (!options.checkoutId) throw new Error('checkoutId is required');
		assertNotCheckedIn(dbs.mini, options.checkoutId);
		const plan = planCheckin(dbs);
		if (!options.apply) {
			dbs.mini.exec('ROLLBACK');
			return plan;
		}
		options.backup?.();
		if (plan.fastPath) replaceContent(dbs);
		else applyPlan(dbs, plan);
		dbs.mini.prepare('INSERT INTO meta (key, value) VALUES (?, ?)')
			.run(checkinKey(options.checkoutId), `${new Date().toISOString()}, ${plan.actions.length} action(s)`);
		dbs.mini.exec('COMMIT');
		return plan;
	} catch (caught) {
		if (dbs.mini.isTransaction) dbs.mini.exec('ROLLBACK');
		throw caught;
	}
};
