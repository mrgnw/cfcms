import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { runGit } from './git';
import { contentBaseDirectory } from './paths';

export class CheckoutBusyError extends Error {
	constructor() {
		super('Blog checkout is busy: a publish or backup is already running. Retry when it finishes.');
	}
}

let held = false;

export const withCheckoutLock = async <T>(operation: () => Promise<T>): Promise<T> => {
	if (held) throw new CheckoutBusyError();
	held = true;
	let lock: DatabaseSync | null = null;
	try {
		const gitPath = await runGit(['rev-parse', '--git-path', 'cms-publish.lock']);
		if (!gitPath.ok) throw new Error(`Cannot locate publish lock: ${gitPath.output}`);
		lock = new DatabaseSync(resolve(contentBaseDirectory, gitPath.output.trim()));
		try {
			lock.exec('PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE');
		} catch (caught) {
			if (caught instanceof Error && 'errcode' in caught && caught.errcode === 5) {
				throw new CheckoutBusyError();
			}
			throw caught;
		}
		return await operation();
	} finally {
		try {
			lock?.close();
		} finally {
			held = false;
		}
	}
};
