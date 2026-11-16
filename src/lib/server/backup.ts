import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { getMetaValue, setMetaValue, vacuumInto } from './db';
import { commitPaths, pushContent } from './git';
import { contentBaseDirectory } from './paths';
import { assertCheckoutWriteLock, CheckoutBusyError, withCheckoutLock } from './checkout-lock';
import { assertPendingPublishTip, setPendingPublishPush } from './publish-push';

const backupRelativePath = '.cms/cms-backup.db';
const dailyMs = 24 * 60 * 60 * 1000;

export const backupLockedCheckout = async () => {
	assertCheckoutWriteLock();
	await assertPendingPublishTip();
	const target = resolve(contentBaseDirectory, backupRelativePath);
	const temp = `${target}.tmp`;
	await mkdir(dirname(target), { recursive: true });
	await rm(temp, { force: true });
	vacuumInto(temp);
	await rename(temp, target);
	const commit = await commitPaths([backupRelativePath], 'cms: db backup');
	if (!commit.ok) throw new Error(`Backup commit failed: ${commit.output}`);
	const push = await pushContent();
	if (!push.ok) throw new Error(`Backup push failed: ${push.output}`);
	setPendingPublishPush(null);
	setMetaValue('lastBackupAt', new Date().toISOString());
};

let running: Promise<void> | null = null;

export const runBackup = () => {
	running ??= withCheckoutLock(backupLockedCheckout).finally(() => {
		running = null;
	});
	return running;
};

export const maybeDailyBackup = () => {
	const last = getMetaValue('lastBackupAt');
	if (last && Date.now() - Date.parse(last) < dailyMs) return;
	runBackup().catch((caught) => {
		if (!(caught instanceof CheckoutBusyError)) console.error('backup failed', caught);
	});
};
