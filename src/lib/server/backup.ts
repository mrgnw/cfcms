import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { getMetaValue, setMetaValue, vacuumInto } from './db';
import { commitPaths, pushContent } from './git';
import { contentBaseDirectory } from './paths';
import { CheckoutBusyError, withCheckoutLock } from './checkout-lock';

const backupRelativePath = '.cms/cms-backup.db';
const dailyMs = 24 * 60 * 60 * 1000;

export const backupLockedCheckout = async () => {
	const target = resolve(contentBaseDirectory, backupRelativePath);
	const temp = `${target}.tmp`;
	await mkdir(dirname(target), { recursive: true });
	await rm(temp, { force: true });
	vacuumInto(temp);
	await rename(temp, target);
	await commitPaths([backupRelativePath], 'cms: db backup');
	await pushContent();
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
