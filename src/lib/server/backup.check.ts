import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'cms-backup-check-'));
const blog = join(root, 'blog');
const remote = join(root, 'remote.git');
const git = (...args: string[]) => execFileSync('git', ['-C', blog, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
execFileSync('git', ['init', '-q', '-b', 'main', blog]);
execFileSync('git', ['init', '-q', '--bare', remote]);
git('config', 'user.name', 'CMS Test');
git('config', 'user.email', 'cms-test@example.test');
git('config', 'commit.gpgsign', 'false');
git('remote', 'add', 'origin', remote);
writeFileSync(join(blog, 'seed.txt'), 'Disposable backup fixture.');
git('add', 'seed.txt');
git('commit', '-qm', 'initial backup fixture');
git('push', '-qu', 'origin', 'main');
process.env.BLOG_CONTENT_BASE_DIR = blog;
process.env.BLOG_CMS_DB = join(root, 'cms.db');

const { appendRevision, getMetaValue, setMetaValue } = await import('./db.ts');
const { maybeDailyBackup, runBackup } = await import('./backup.ts');
const { setPendingPublishPush } = await import('./publish-push.ts');

try {
	appendRevision('backup.md', 'title: Backup', 'Original backup state.', 'original', 'cms');
	await runBackup();
	const lastSuccessful = getMetaValue('lastBackupAt');
	assert.ok(lastSuccessful);
	setMetaValue('lastBackupAt', '2000-01-01T00:00:00.000Z');
	setMetaValue('lastBackupAttemptAt', '2000-01-01T00:00:00.000Z');
	writeFileSync(join(remote, 'hooks/pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
	await maybeDailyBackup();
	const pendingTip = git('rev-parse', 'HEAD');
	const lastAttempt = getMetaValue('lastBackupAttemptAt');
	assert.equal(getMetaValue('pendingBackupPush'), pendingTip);
	assert.equal(getMetaValue('lastBackupAt'), '2000-01-01T00:00:00.000Z');
	appendRevision('backup.md', 'title: Backup', 'Changed while the remote is unavailable.', 'changed', 'cms');
	for (let poll = 0; poll < 5; poll += 1) await maybeDailyBackup();
	assert.equal(git('rev-parse', 'HEAD'), pendingTip, 'polls during the cooldown cannot create backup commits');
	assert.equal(getMetaValue('lastBackupAttemptAt'), lastAttempt, 'the cooldown persists in SQLite');
	for (let retry = 0; retry < 3; retry += 1) {
		setMetaValue('lastBackupAttemptAt', '2000-01-01T00:00:00.000Z');
		await maybeDailyBackup();
		assert.equal(git('rev-parse', 'HEAD'), pendingTip, 'later failed retries reuse the captured backup commit');
	}
	await assert.rejects(runBackup(), /Backup push failed/);
	assert.equal(git('rev-parse', 'HEAD'), pendingTip, 'explicit retries also reuse the pending commit');
	writeFileSync(join(blog, 'unrelated.txt'), 'Do not automatically push this descendant.');
	git('add', 'unrelated.txt');
	git('commit', '-qm', 'unrelated descendant');
	const unrelatedTip = git('rev-parse', 'HEAD');
	await assert.rejects(runBackup(), /HEAD moved after the pending backup/);
	assert.equal(git('rev-parse', 'HEAD'), unrelatedTip);
	assert.notEqual(git('rev-parse', 'origin/main'), unrelatedTip);
	git('reset', '--hard', pendingTip);
	rmSync(join(remote, 'hooks/pre-receive'));
	setMetaValue('lastBackupAttemptAt', '2000-01-01T00:00:00.000Z');
	await maybeDailyBackup();
	assert.equal(git('rev-parse', 'origin/main'), pendingTip, 'the original backup recovers after the remote heals');
	assert.equal(getMetaValue('pendingBackupPush'), '');
	assert.notEqual(getMetaValue('lastBackupAt'), '2000-01-01T00:00:00.000Z');
	await maybeDailyBackup();
	assert.equal(git('rev-parse', 'HEAD'), pendingTip, 'a recovered backup does not immediately create another snapshot');
	setPendingPublishPush(pendingTip);
	const attemptBeforePendingPublish = getMetaValue('lastBackupAttemptAt');
	await maybeDailyBackup();
	await assert.rejects(runBackup(), /publish push is pending/);
	assert.equal(git('rev-parse', 'HEAD'), pendingTip);
	assert.equal(getMetaValue('lastBackupAttemptAt'), attemptBeforePendingPublish);
	assert.equal(getMetaValue('pendingPublishPush'), pendingTip, 'backups leave pending publication to explicit retry');
	console.log('backup.check: ok');
} finally {
	rmSync(root, { recursive: true, force: true });
}
