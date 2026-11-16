import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { getMetaValue, setMetaValue, vacuumInto } from './db';
import { commitPaths, getHeadCommit, pushContent } from './git';
import { contentBaseDirectory } from './paths';
import { assertCheckoutWriteLock, CheckoutBusyError, withCheckoutLock } from './checkout-lock';
import { assertNoPendingPublishMutation, hasPendingPublishPush, isCommitOnRemoteMain } from './publish-push';

const backupRelativePath = '.cms/cms-backup.db';
const dailyMs = 24 * 60 * 60 * 1000;
const retryDelayMs = 5 * 60 * 1000;
const pendingBackupKey = 'pendingBackupPush';

const recordBackupSuccess = () => {
	setMetaValue(pendingBackupKey, '');
	setMetaValue('lastBackupAt', new Date().toISOString());
};

const pushBackup = async () => {
	const push = await pushContent();
	if (!push.ok) throw new Error(`Backup push failed: ${push.output}`);
	recordBackupSuccess();
};

export const backupLockedCheckout = async () => {
	assertCheckoutWriteLock();
	assertNoPendingPublishMutation('creating a backup');
	setMetaValue('lastBackupAttemptAt', new Date().toISOString());
	const pending = getMetaValue(pendingBackupKey);
	if (pending) {
		if (pending !== await getHeadCommit()) {
			if (await isCommitOnRemoteMain(pending)) {
				recordBackupSuccess();
				return;
			}
			throw new Error('Blog HEAD moved after the pending backup; reconcile it before retrying the backup push');
		}
		await pushBackup();
		return;
	}
	const target = resolve(contentBaseDirectory, backupRelativePath);
	const temp = `${target}.tmp`;
	await mkdir(dirname(target), { recursive: true });
	await rm(temp, { force: true });
	vacuumInto(temp);
	await rename(temp, target);
	const commit = await commitPaths([backupRelativePath], 'cms: db backup');
	if (!commit.ok) throw new Error(`Backup commit failed: ${commit.output}`);
	const head = await getHeadCommit();
	if (!head) throw new Error('Cannot record the pending backup: Git HEAD is unavailable');
	setMetaValue(pendingBackupKey, head);
	await pushBackup();
};

let running: Promise<void> | null = null;

export const runBackup = () => {
	running ??= withCheckoutLock(backupLockedCheckout).finally(() => {
		running = null;
	});
	return running;
};

export const maybeDailyBackup = () => {
	if (hasPendingPublishPush()) return;
	const attempt = getMetaValue('lastBackupAttemptAt');
	if (attempt && Date.now() - Date.parse(attempt) < retryDelayMs) return;
	const last = getMetaValue('lastBackupAt');
	if (!getMetaValue(pendingBackupKey) && last && Date.now() - Date.parse(last) < dailyMs) return;
	return runBackup().catch((caught) => {
		if (!(caught instanceof CheckoutBusyError)) console.error('backup failed', caught);
	});
};
