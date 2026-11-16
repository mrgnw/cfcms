import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { getMetaValue, setMetaValue, vacuumInto } from './db';
import { commitPaths, getCurrentBranch, getHeadCommit, pushContent, runGit } from './git';
import { mainBranchError } from '#lib/branch.js';
import { contentBaseDirectory } from './paths';
import { assertCheckoutWriteLock, CheckoutBusyError, withCheckoutLock } from './checkout-lock';
import { assertNoPendingPublishMutation, getRemoteMain, hasPendingPublishPush, isAncestor } from './publish-push';
import { snapshotPublishTree } from './publish-snapshot';

const backupRelativePath = '.cms/cms-backup.db';
const dailyMs = 24 * 60 * 60 * 1000;
const retryDelayMs = 5 * 60 * 1000;
const pendingBackupKey = 'pendingBackupPush';

const recordBackupSuccess = () => {
	setMetaValue(pendingBackupKey, '');
	setMetaValue('lastBackupAt', new Date().toISOString());
	setMetaValue('lastBackupError', '');
};

export const getBackupStatus = () => {
	const pending = getMetaValue(pendingBackupKey);
	return {
		pendingCommit: pending,
		lastBackupAt: getMetaValue('lastBackupAt'),
		error: getMetaValue('lastBackupError'),
		message: getMetaValue('backupRecoveryMessage'),
		remoteCommit: pending && pending === getMetaValue('backupRecoveryPending') ? getMetaValue('backupRecoveryRemote') : null
	};
};

const backupIsDelivered = async (pending: string, remote: string) => {
	const exists = await runGit(['cat-file', '-e', `${pending}^{commit}`], 10_000);
	if (!exists.ok) return false;
	if (await isAncestor(pending, remote)) return true;
	const captured = await runGit(['ls-tree', pending, '--', backupRelativePath], 10_000);
	const delivered = await runGit(['ls-tree', remote, '--', backupRelativePath], 10_000);
	if (!captured.ok || !delivered.ok) throw new Error('Cannot inspect the saved backup artifact');
	return /^100644 blob [0-9a-f]+\t\.cms\/cms-backup\.db\n$/.test(captured.output)
		&& captured.output === delivered.output;
};

const pushBackup = async (commit: string) => {
	const push = await pushContent(commit);
	if (!push.ok) throw new Error(`Backup push failed: ${push.output}`);
	recordBackupSuccess();
};

const captureBackup = async () => {
	const target = resolve(contentBaseDirectory, backupRelativePath);
	const temp = `${target}.tmp`;
	const snapshot = await snapshotPublishTree([backupRelativePath]);
	let committed = false;
	try {
		await mkdir(dirname(target), { recursive: true });
		await rm(temp, { force: true });
		vacuumInto(temp);
		await rename(temp, target);
		const commit = await commitPaths([backupRelativePath], 'cms: db backup');
		if (!commit.ok) throw new Error(`Backup commit failed: ${commit.output}`);
		committed = true;
		const head = await getHeadCommit();
		if (!head) throw new Error('Cannot record the pending backup: Git HEAD is unavailable');
		return head;
	} finally {
		await rm(temp, { force: true });
		if (!committed) await snapshot.restore();
		await snapshot.discard();
	}
};

const recordFailure = (caught: unknown) => {
	setMetaValue('lastBackupError', (caught instanceof Error ? caught.message : String(caught)).slice(0, 2000));
};

export const backupLockedCheckout = async () => {
	assertCheckoutWriteLock();
	assertNoPendingPublishMutation('creating a backup');
	try {
		const branchError = mainBranchError(await getCurrentBranch());
		if (branchError) throw new Error(branchError);
		setMetaValue('lastBackupAttemptAt', new Date().toISOString());
		const pending = getMetaValue(pendingBackupKey);
		if (pending) {
			if (await backupIsDelivered(pending, await getRemoteMain())) {
				recordBackupSuccess();
				return;
			}
			const ancestry = await runGit(['merge-base', '--is-ancestor', pending, 'HEAD'], 10_000);
			if (!ancestry.ok) {
				throw new Error('Blog HEAD no longer contains the saved backup. Use Verify backup delivery on the Publish page. If unverified, align a clean checkout to origin/main and explicitly replace the saved backup with a fresh snapshot.');
			}
			await pushBackup(pending);
			return;
		}
		const head = await captureBackup();
		setMetaValue(pendingBackupKey, head);
		await pushBackup(head);
	} catch (caught) {
		recordFailure(caught);
		throw caught;
	}
};

export const reconcileBackup = (expected: string) => withCheckoutLock(async () => {
	if (!expected || expected !== getMetaValue(pendingBackupKey)) throw new CheckoutBusyError('Saved backup changed. Reload before verifying it.');
	const remote = await getRemoteMain();
	const delivered = await backupIsDelivered(expected, remote);
	setMetaValue('backupRecoveryPending', expected);
	setMetaValue('backupRecoveryRemote', remote);
	const message = delivered
		? 'Remote backup delivery verified. No checkout files or saved edits were changed.'
		: 'Saved backup delivery is not verified. Preserve any local Git work, then align a clean main checkout exactly to origin/main. You can explicitly replace the saved backup with a fresh snapshot of the current CMS database. Only the backup artifact will be committed and pushed.';
	setMetaValue('backupRecoveryMessage', message);
	if (delivered) recordBackupSuccess();
	return { ok: delivered, pendingCommit: expected, remoteCommit: remote, message };
});

export const replacePendingBackup = (expected: string, expectedRemote: string) => withCheckoutLock(async () => {
	assertNoPendingPublishMutation('replacing a backup');
	if (!expected || expected !== getMetaValue(pendingBackupKey)) throw new CheckoutBusyError('Saved backup changed. Reload before replacing it.');
	if (expected !== getMetaValue('backupRecoveryPending') || expectedRemote !== getMetaValue('backupRecoveryRemote')) {
		throw new CheckoutBusyError('Verify backup delivery before replacing the saved snapshot.');
	}
	try {
		const remote = await getRemoteMain();
		if (remote !== expectedRemote) throw new CheckoutBusyError('Remote main changed. Verify backup delivery again.');
		const clean = await runGit(['status', '--porcelain', '--untracked-files=normal'], 10_000);
		if (await getCurrentBranch() !== 'main' || await getHeadCommit() !== remote || !clean.ok || clean.output) {
			throw new CheckoutBusyError('Preserve local work and align a clean main checkout exactly to origin/main before replacing the backup. The CMS will not reset or overwrite it.');
		}
		setMetaValue('lastBackupAttemptAt', new Date().toISOString());
		const head = await captureBackup();
		if (head !== remote) {
			const parents = await runGit(['rev-list', '--parents', '--max-count=1', head], 10_000);
			const changed = await runGit(['diff-tree', '--no-commit-id', '--name-only', '-r', remote, head], 10_000);
			if (!parents.ok || parents.output.trim() !== `${head} ${remote}` || !changed.ok || changed.output.trim() !== backupRelativePath) {
				throw new Error('Checkout changed during backup capture. Inspect local Git history before retrying; no commits were pushed.');
			}
		}
		setMetaValue('supersededBackupPush', expected);
		setMetaValue(pendingBackupKey, head);
		await pushBackup(head);
		const message = 'Saved backup replaced with a fresh database snapshot and pushed. Post files and saved edits were unchanged.';
		setMetaValue('backupRecoveryMessage', message);
		return { ok: true, message };
	} catch (caught) {
		recordFailure(caught);
		throw caught;
	}
});

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
