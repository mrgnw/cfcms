import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout } from 'node:timers/promises';

const root = mkdtempSync(join(tmpdir(), 'cms-inventory-http-'));
const databasePath = join(root, 'cms.db');
const origin = 'http://127.0.0.1:15427';
const server = spawn(process.execPath, ['build/index.js'], {
	cwd: process.cwd(),
	env: { ...process.env, BLOG_CMS_DB: databasePath, BLOG_CONTENT_BASE_DIR: root,
		BLOG_CMS_DEPLOY_STATE_FILE: join(root, 'deploy-state.json'), HOST: '127.0.0.1', PORT: '15427', ORIGIN: origin },
	stdio: ['ignore', 'pipe', 'pipe']
});
let output = '';
server.stdout.on('data', (data) => { output = (output + data).slice(-8192); });
server.stderr.on('data', (data) => { output = (output + data).slice(-8192); });
const exited = once(server, 'exit');
const request = (path, method = 'GET') => fetch(origin + path, {
	method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', Origin: origin },
	signal: AbortSignal.timeout(5000)
});
try {
	for (let attempt = 0; attempt < 50 && !output.includes('Listening on'); attempt += 1) {
		if (server.exitCode !== null) throw new Error(output);
		await setTimeout(100);
	}
	assert.ok(output.includes('Listening on'), output);
	assert.equal((await request('/api/inventory')).status, 503);
	assert.deepEqual(readdirSync(root), []);
	assert.equal((await request('/api/inventory?limit=0')).status, 400);
	assert.equal((await request('/api/inventory/not-a-post-id')).status, 400);
	assert.deepEqual(readdirSync(root), [], 'malformed inventory requests cannot initialize the writable store');
	const database = new DatabaseSync(databasePath);
	database.exec(`
		CREATE TABLE posts (id TEXT UNIQUE, path TEXT PRIMARY KEY, head_rev INTEGER, published_hash TEXT,
			published_title TEXT, published_slug TEXT, published_commit TEXT, published_at TEXT,
			staged INTEGER, editing_order INTEGER);
		CREATE TABLE revisions (path TEXT, rev INTEGER, hash TEXT, writer TEXT, saved_at TEXT,
			frontmatter TEXT, body TEXT, PRIMARY KEY(path, rev));
		CREATE TABLE versions (path TEXT, writer TEXT, session_id TEXT, base_hash TEXT,
			updated_at TEXT, frontmatter TEXT, body TEXT, PRIMARY KEY(path, writer));
		INSERT INTO posts (id, path, head_rev) VALUES ('aaaaaa', 'assistant.md', 1);
		INSERT INTO revisions VALUES ('assistant.md', 1, 'human-hash', 'cms', '2026-01-01', 'title: Assistant', '');
		INSERT INTO versions VALUES ('assistant.md', 'llm', 'file', 'human-hash', '2026-01-01', 'title: Assistant', 'Proposal');
	`);
	database.close();
	mkdirSync(join(root, 'content'));
	writeFileSync(join(root, 'content/unimported.llm.md'), 'Unimported draft');
	const before = readFileSync(databasePath);
	const list = await request('/api/inventory?limit=1');
	assert.equal(list.status, 200);
	assert.match(list.headers.get('cache-control'), /no-store/);
	const inventory = await list.json();
	assert.equal(inventory.posts[0].hasAssistantDraft, true);
	const detail = await request('/api/inventory/aaaaaa');
	assert.equal(detail.status, 200);
	const post = await detail.json();
	assert.equal(post.human.body, '');
	assert.equal(post.versions[0].body, 'Proposal');
	assert.equal(post.versions[0].contentHash.length, 64);
	assert.equal((await request('/api/inventory/cccccc')).status, 404);
	assert.equal((await request('/api/inventory/aaaaaa', 'HEAD')).status, 200);
	for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
		const response = await request('/api/inventory', method);
		assert.equal(response.status, 405, `${method}: ${await response.text()}`);
		assert.equal((await request('/api/inventory/aaaaaa', method)).status, 405);
	}
	assert.deepEqual(readFileSync(databasePath), before);
	assert.deepEqual(readdirSync(root).sort(), ['cms.db', 'content']);
	assert.equal(readFileSync(join(root, 'content/unimported.llm.md'), 'utf8'), 'Unimported draft');
	console.log('inventory HTTP: GET, HEAD, validation, 404, 405, no-store, and unchanged fixture passed');
} finally {
	server.kill('SIGTERM');
	await Promise.race([exited, setTimeout(2000)]);
	if (server.exitCode === null) {
		server.kill('SIGKILL');
		await exited;
	}
	rmSync(root, { recursive: true, force: true });
}
