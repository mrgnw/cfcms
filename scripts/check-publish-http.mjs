import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
	writeFileSync(join(remote, 'hooks/pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
	assert.equal((await request('/api/publish', {})).status, 502);
	const captured = git('rev-parse', 'HEAD');
	rmSync(join(remote, 'hooks/pre-receive'));
	const peer = join(root, 'peer');
	execFileSync('git', ['clone', '-q', '-b', 'main', remote, peer]);
	const peerGit = (...args) => execFileSync('git', ['-C', peer, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
	peerGit('config', 'user.name', 'CMS HTTP Peer');
	peerGit('config', 'user.email', 'cms-peer@example.test');
	peerGit('config', 'commit.gpgsign', 'false');
	writeFileSync(join(peer, 'remote-only.txt'), 'Independent remote change.\n');
	peerGit('add', '.');
	peerGit('commit', '-qm', 'remote advanced');
	peerGit('push', '-q', 'origin', 'main');
	const unverified = await request(`/api/publish/reconcile?commit=${captured}`, {});
	assert.equal(unverified.status, 409);
	assert.equal((await unverified.json()).ok, false);
	assert.equal(database.prepare('SELECT value FROM meta WHERE key = ?').get('pendingPublishPush').value, captured);
	const patch = await request(`/api/publish/reconcile?patch=${captured}`);
	assert.equal(patch.status, 200);
	assert.match(patch.headers.get('cache-control'), /\bno-store\b/);
	assert.match(await patch.text(), /\+later body/);
	const recoveryPage = await (await request('/publish')).text();
	assert.match(recoveryPage, /The captured publication is waiting for remote delivery/);
	assert.match(recoveryPage, /Verify remote delivery/);
	assert.match(recoveryPage, /Download captured patch/);
	git('rebase', 'origin/main');
	git('push', '-q', 'origin', 'main');
	const rewritten = git('rev-parse', 'HEAD');
	assert.notEqual(rewritten, captured);
	assert.equal(git('rev-parse', 'refs/cfcms/pending-publication'), captured);
	git('reflog', 'expire', '--expire=now', '--all');
	git('gc', '--prune=now');
	git('cat-file', '-e', `${captured}^{commit}`);
	peerGit('pull', '--ff-only', '-q');
	peerGit('revert', '--no-edit', rewritten);
	peerGit('push', '-q', 'origin', 'main');
	const editedRemote = peerGit('rev-parse', 'HEAD');
	writeFileSync(join(blog, 'local-only.txt'), 'Do not push this local work.\n');
	git('add', 'local-only.txt');
	git('commit', '-qm', 'local work after manual push');
	const localOnly = git('rev-parse', 'HEAD');
	const preservedIndex = readFileSync(join(blog, '.git/index'));
	const revertedPreview = await request(`/api/publish/reconcile?commit=${captured}`, {});
	assert.equal(revertedPreview.status, 409);
	const preview = await revertedPreview.json();
	assert.deepEqual(preview.currentRemote.differences, [
		{ path: 'content/later.md', kind: 'deleted', matchesBefore: true },
		{ path: 'src/posts/later.svx', kind: 'deleted', matchesBefore: true }
	]);
	const confirmationPage = await (await request('/publish')).text();
	assert.match(confirmationPage, /Confirm historical Git delivery/);
	assert.match(confirmationPage, /Absent from remote/);
	assert.match(confirmationPage, /Historical Git delivery does not establish current live content/);
	assert.ok(confirmationPage.indexOf('Absent from remote') < confirmationPage.indexOf('value="reviewed-history-and-current-remote"'));
	const preservedPosts = database.prepare('SELECT * FROM posts ORDER BY path').all();
	assert.equal((await request(`/api/publish/reconcile?commit=${captured}&delivered=${rewritten}&remote=${editedRemote}`, {})).status, 400,
		'historical delivery cannot be inferred without explicit author confirmation');
	assert.equal((await request(`/api/publish/reconcile?commit=${captured}&delivered=${rewritten}&remote=${editedRemote}&confirm=reviewed-delivery`, {})).status, 400,
		'legacy acknowledgement cannot skip review of the current remote snapshot');
	const verified = await request('/api/publish/reconcile', {
		commit: captured, delivered: rewritten, remote: editedRemote, confirm: 'reviewed-history-and-current-remote'
	});
	assert.equal(verified.status, 200, await verified.clone().text());
	const deliveryReport = await verified.json();
	assert.equal(deliveryReport.remoteCommit, editedRemote);
	assert.equal(deliveryReport.deliveryCommit, rewritten);
	assert.equal(deliveryReport.authorConfirmed, true);
	assert.deepEqual(deliveryReport.currentRemote, preview.currentRemote);
	assert.match(deliveryReport.message, /Historical Git delivery/);
	assert.match(deliveryReport.message, /does not verify current deployment or live content/);
	assert.equal(git('rev-parse', 'HEAD'), localOnly);
	assert.equal(git('rev-parse', 'origin/main'), editedRemote);
	assert.equal(existsSync(join(peer, 'content/later.md')), false);
	assert.equal(existsSync(join(peer, 'src/posts/later.svx')), false);
	assert.deepEqual(readFileSync(join(blog, '.git/index')), preservedIndex);
	assert.deepEqual(database.prepare('SELECT * FROM posts ORDER BY path').all(), preservedPosts);
	assert.equal(database.prepare('SELECT value FROM meta WHERE key = ?').get('pendingPublishPush').value, '');
	const receipt = await (await request('/api/publish/reconcile')).json();
	assert.equal(receipt.lastDelivery.commit, rewritten);
	assert.equal(receipt.lastDelivery.capturedCommit, captured);
	assert.deepEqual(receipt.lastDelivery.currentRemote, preview.currentRemote);
	assert.equal((await request(`/api/publish/reconcile?commit=${captured}`, {})).status, 409);
	const missing = 'a'.repeat(40);
	database.prepare('INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
		.run('pendingBackupPush', missing);
	const absentBackup = await request(`/api/backup/reconcile?commit=${missing}`, {});
	assert.equal(absentBackup.status, 409);
	const backupReport = await absentBackup.json();
	const replaceUrl = `/api/backup/reconcile?commit=${missing}&replace=${backupReport.remoteCommit}`;
	assert.equal((await request(replaceUrl, {})).status, 409, 'replacement preserves unrelated local commits');
	assert.equal(git('rev-parse', 'HEAD'), localOnly);
	assert.match(await (await request('/publish')).text(), /align a clean main checkout/);
	git('reset', '--hard', 'origin/main');
	writeFileSync(join(remote, 'hooks/pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
	assert.equal((await request(replaceUrl, {})).status, 502);
	const replacement = database.prepare('SELECT value FROM meta WHERE key = ?').get('pendingBackupPush').value;
	assert.notEqual(replacement, missing);
	assert.equal(git('diff', '--name-only', 'origin/main', 'HEAD'), '.cms/cms-backup.db');
	const backupPage = await (await request('/publish')).text();
	assert.match(backupPage, /Backup needs attention/);
	assert.match(backupPage, /Backup push failed/);
	rmSync(join(remote, 'hooks/pre-receive'));
	const backupRetry = await request(`/api/backup/reconcile?commit=${replacement}&retry=1`, {});
	assert.equal(backupRetry.status, 200, await backupRetry.clone().text());
	assert.equal(git('rev-parse', 'origin/main'), replacement);
	assert.equal((await (await request('/api/backup/reconcile')).json()).pendingCommit, '');
	database.close();
	console.log('publish HTTP: purge feedback, polling deferral, rewritten delivery, unverified patch, missing backup recovery and restored-remote retry passed');
} finally {
	server.kill('SIGTERM');
	await Promise.race([exited, setTimeout(2000)]);
	if (server.exitCode === null) {
		server.kill('SIGKILL');
		await exited;
	}
	rmSync(root, { recursive: true, force: true });
}
