import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { runGit } from './git';
import { contentBaseDirectory } from './paths';

export class CheckoutBusyError extends Error {
	constructor(message = 'Blog checkout is busy: another CMS write operation is already running. Retry when it finishes.') {
		super(message);
	}
}

let held = false;
let writerOwned = false;
let readers = 0;
const inspectionWaitAttempts = 100;
const inspectionWaitMs = 10;

const sqliteBusy = (caught: unknown) => caught instanceof Error && 'errcode' in caught && caught.errcode === 5;

const openLock = async () => {
	const gitPath = await runGit(['rev-parse', '--git-path', 'cms-publish.lock']);
	if (!gitPath.ok) throw new Error(`Cannot locate publish lock: ${gitPath.output}`);
	const lock = new DatabaseSync(resolve(contentBaseDirectory, gitPath.output.trim()));
	try {
		lock.exec('PRAGMA busy_timeout = 0');
	} catch (caught) {
		lock.close();
		throw caught;
	}
	return lock;
};

const acquireWriteLock = async (lock: DatabaseSync) => {
	for (let attempt = 0; attempt < inspectionWaitAttempts; attempt += 1) {
		try {
			lock.exec('BEGIN EXCLUSIVE');
			return;
		} catch (caught) {
			if (!sqliteBusy(caught)) throw caught;
		}
		try {
			lock.exec('BEGIN IMMEDIATE; ROLLBACK');
		} catch (caught) {
			if (sqliteBusy(caught)) throw new CheckoutBusyError();
			throw caught;
		}
		await setTimeout(inspectionWaitMs);
	}
	throw new CheckoutBusyError('Blog checkout is busy: content inspection has not finished. Retry shortly.');
};

export const assertCheckoutWriteLock = () => assert.ok(writerOwned, 'Checkout mutation requires the write lock');
export const assertCheckoutReadLock = () => assert.ok(writerOwned || readers > 0, 'Checkout inspection requires a lock');

export const withCheckoutLock = async <T>(operation: () => Promise<T>): Promise<T> => {
	if (held) throw new CheckoutBusyError();
	held = true;
	let lock: DatabaseSync | null = null;
	try {
		lock = await openLock();
		await acquireWriteLock(lock);
		writerOwned = true;
		return await operation();
	} finally {
		try {
			lock?.close();
		} finally {
			writerOwned = false;
			held = false;
		}
	}
};

export const withCheckoutReadLock = async <T>(operation: () => Promise<T>): Promise<T> => {
	if (held) throw new CheckoutBusyError();
	const lock = await openLock();
	try {
		try {
			lock.exec('BEGIN; SELECT name FROM sqlite_schema');
		} catch (caught) {
			if (sqliteBusy(caught)) throw new CheckoutBusyError();
			throw caught;
		}
		readers += 1;
		try {
			return await operation();
		} finally {
			readers -= 1;
		}
	} finally {
		lock.close();
	}
};
