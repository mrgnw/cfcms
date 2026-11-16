import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = mkdtempSync(join(tmpdir(), 'cms-publish-http-'));
const blog = join(root, 'blog');
const remote = join(root, 'remote.git');
const databasePath = join(root, 'cms.db');
const origin = 'http://127.0.0.1:15431';
const git = (...args) => execFileSync('git', ['-C', blog, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
execFileSync('git', ['init', '-q', '-b', 'main', blog]);
execFileSync('git', ['init', '-q', '--bare', remote]);
git('config', 'user.name', 'CMS HTTP Test');
git('config', 'user.email', 'cms-http@example.test');
git('config', 'commit.gpgsign', 'false');
git('remote', 'add', 'origin', remote);
mkdirSync(join(blog, 'content'));
mkdirSync(join(blog, 'src/posts'), { recursive: true });
writeFileSync(join(blog, 'src/posts/live.svx'), '---\ntitle: Live\ndate: 2026-01-01\npublished: true\n---\n\nLive body.\n');
for (const name of ['pending', 'later']) {
	writeFileSync(join(blog, `content/${name}.md`), `---\ntitle: ${name}\ndate: 2026-01-01\npublish: true\n---\n\n${name} body.\n`);
}
git('add', '.');
git('commit', '-qm', 'HTTP publication fixture');
git('push', '-qu', 'origin', 'main');
const server = spawn(process.execPath, [fileURLToPath(new URL('../build/index.js', import.meta.url))], {
	cwd: root,
	env: {
		...process.env, BLOG_CMS_DB: databasePath, BLOG_CONTENT_BASE_DIR: blog,
		BLOG_CMS_DEPLOY_STATE_FILE: join(root, 'deploy-state.json'), BLOG_BUILD_COMMAND: 'true',
		HOST: '0.0.0.0', PORT: '15431', PROTOCOL_HEADER: 'x-forwarded-proto'
	},
	stdio: ['ignore', 'pipe', 'pipe']
});
let output = '';
server.stdout.on('data', (data) => { output = (output + data).slice(-8192); });
server.stderr.on('data', (data) => { output = (output + data).slice(-8192); });
const exited = once(server, 'exit');
const request = (path, form) => fetch(origin + path, {
	method: form === undefined ? 'GET' : 'POST',
	headers: { Accept: 'application/json', Origin: origin, 'x-forwarded-proto': 'http' },
	body: form === undefined ? undefined : new URLSearchParams(form),
	signal: AbortSignal.timeout(15_000)
});
try {
	for (let attempt = 0; attempt < 50 && !output.includes('Listening on'); attempt += 1) {
		if (server.exitCode !== null) throw new Error(output);
		await setTimeout(100);
	}
	assert.ok(output.includes('Listening on'), output);
	assert.equal((await request('/publish')).status, 200);
	const staged = await request('/publish?/stage', { path: 'pending.md' });
	assert.equal(staged.status, 200, await staged.text());
	writeFileSync(join(remote, 'hooks/pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
	const failedPublish = await request('/api/publish', {});
	assert.equal(failedPublish.status, 502, await failedPublish.text());
	const head = git('rev-parse', 'HEAD');
	const index = readFileSync(join(blog, '.git/index'));
	const boundary = readFileSync(join(blog, 'content/pending.md'));
	const refused = await request('/publish?/purge', { path: 'pending.md' });
	assert.equal(refused.status, 409);
	const failure = await refused.json();
	assert.equal(failure.type, 'failure');
	assert.match(failure.data, /publish push is pending.*Retry the publish push before purging posts/);
	assert.equal(git('rev-parse', 'HEAD'), head);
	assert.deepEqual(readFileSync(join(blog, '.git/index')), index);
	assert.deepEqual(readFileSync(join(blog, 'content/pending.md')), boundary);
	const database = new DatabaseSync(databasePath);
	database.prepare("UPDATE meta SET value = ? WHERE key IN ('lastBackupAt', 'lastBackupAttemptAt')")
		.run('2000-01-01T00:00:00.000Z');
	assert.equal(database.prepare('SELECT count(*) AS count FROM posts WHERE path = ?').get('pending.md').count, 1);
	for (let poll = 0; poll < 5; poll += 1) assert.equal((await request('/api/posts')).status, 200);
	assert.equal(git('rev-parse', 'HEAD'), head, 'daily polling cannot append commits to a pending publication');
	assert.equal(database.prepare('SELECT value FROM meta WHERE key = ?').get('lastBackupAttemptAt').value,
		'2000-01-01T00:00:00.000Z', 'pending publication defers attempts even when the backup cooldown has expired');
	assert.equal((await request('/publish?/stage', { path: 'later.md' })).status, 200);
	const pendingPage = await request('/publish');
	assert.match(await pendingPage.text(), /Retry publish push/);
	rmSync(join(remote, 'hooks/pre-receive'));
	const retry = await request('/api/publish', {});
	assert.equal(retry.status, 200, await retry.clone().text());
	const retried = await retry.json();
	assert.equal(retried.stagedCount, 0);
	assert.deepEqual(retried.results, []);
	assert.equal(git('rev-parse', 'HEAD'), git('rev-parse', 'origin/main'));
	const later = database.prepare('SELECT staged, published_hash FROM posts WHERE path = ?').get('later.md');
	assert.equal(later.staged, 1, 'new staging survives recovery of the previous publication');
	assert.equal(later.published_hash, null);
	assert.equal(database.prepare('SELECT value FROM meta WHERE key = ?').get('pendingPublishPush').value, '');
	database.close();
	console.log('publish HTTP: pending-purge 409 feedback, unchanged checkout, deferred polling and restored-remote retry passed');
} finally {
	server.kill('SIGTERM');
	await Promise.race([exited, setTimeout(2000)]);
	if (server.exitCode === null) {
		server.kill('SIGKILL');
		await exited;
	}
	rmSync(root, { recursive: true, force: true });
}
