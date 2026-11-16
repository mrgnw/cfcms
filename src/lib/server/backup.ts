import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { getMetaValue, setMetaValue, vacuumInto } from './db';
import { commitPaths, getCurrentBranch, getHeadCommit, pushContent, runGit } from './git';
import { mainBranchError } from '#lib/branch.js';
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

const pushBackup = async (commit: string) => {
	const push = await pushContent(commit);
	if (!push.ok) throw new Error(`Backup push failed: ${push.output}`);
	recordBackupSuccess();
};

export const backupLockedCheckout = async () => {
	assertCheckoutWriteLock();
	assertNoPendingPublishMutation('creating a backup');
	const branchError = mainBranchError(await getCurrentBranch());
	if (branchError) throw new Error(branchError);
	setMetaValue('lastBackupAttemptAt', new Date().toISOString());
	const pending = getMetaValue(pendingBackupKey);
	if (pending) {
		if (await isCommitOnRemoteMain(pending)) {
			recordBackupSuccess();
			return;
		}
		const ancestry = await runGit(['merge-base', '--is-ancestor', pending, 'HEAD'], 10_000);
		if (!ancestry.ok) throw new Error('Blog HEAD no longer contains the pending backup; reconcile it before retrying');
		await pushBackup(pending);
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
	await pushBackup(head);
};

let running: Promise<void> | null = null;

const startBackup = (operation: () => Promise<void>) => {
	running ??= withCheckoutLock(operation).finally(() => {
		running = null;
	});
	return running;
};

export const runBackup = () => startBackup(backupLockedCheckout);

const backupIsDue = () => {
	if (hasPendingPublishPush()) return false;
	if (!getMetaValue('importedCorpus') || !getMetaValue('importedSvxBaseline') || !getMetaValue('repairedSiteBase')) return false;
	const now = Date.now();
	const attemptAge = now - Date.parse(getMetaValue('lastBackupAttemptAt') ?? '');
	if (attemptAge >= 0 && attemptAge < retryDelayMs) return false;
	const successAge = now - Date.parse(getMetaValue('lastBackupAt') ?? '');
	if (!getMetaValue(pendingBackupKey) && successAge >= 0 && successAge < dailyMs) return false;
	return true;
};

export const maybeDailyBackup = () => {
	if (!backupIsDue()) return;
	return startBackup(async () => {
		if (backupIsDue()) await backupLockedCheckout();
	}).catch((caught) => {
		if (!(caught instanceof CheckoutBusyError)) console.error('backup failed', caught);
	});
};
