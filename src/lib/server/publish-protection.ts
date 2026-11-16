import type { PublicationReconciliation, PublicationRemoteState } from '#lib/types.js';
import { assertCheckoutWriteLock, CheckoutBusyError } from './checkout-lock';
import { getMetaValue, setMetaValue } from './db';
import { runGit } from './git';
import { getRemoteMain } from './publish-push';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const key = 'publishRecoveryReconciliation';
const commitPattern = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

export class PublicationReconciliationError extends CheckoutBusyError {
	readonly paths: string[];

	constructor(paths: string[], message: string) {
		super(message);
		this.paths = paths;
	}
}

export const getPublicationReconciliation = (): PublicationReconciliation | null => {
	const saved = getMetaValue(key);
	if (!saved) return null;
	try {
		const state = JSON.parse(saved) as PublicationReconciliation;
		if (!state || !commitPattern.test(state.capturedCommit ?? '') || !commitPattern.test(state.remoteCommit ?? '')
			|| !Array.isArray(state.paths) || !state.paths.length || !state.paths.every((path) => typeof path === 'string' && path.length)) throw new Error();
		return { ...state, error: null };
	} catch {
		return { capturedCommit: null, remoteCommit: null, paths: [], error: 'Saved publication reconciliation protection is invalid. Restore its metadata from backup before publishing.' };
	}
};

export const protectRecoveredPublication = (state: PublicationRemoteState) => {
	assertCheckoutWriteLock();
	if (!state.differences.length) return;
	const previous = getPublicationReconciliation();
	if (previous?.error) throw new PublicationReconciliationError([], previous.error);
	setMetaValue(key, JSON.stringify({
		capturedCommit: state.capturedCommit, remoteCommit: state.remoteCommit,
		paths: [...new Set([...(previous?.paths ?? []), ...state.differences.map(({ path }) => path)])]
	}));
};

export const assertRecoveredPathsPreserved = async (paths: string[]) => {
	assertCheckoutWriteLock();
	const saved = getMetaValue(key);
	const protection = getPublicationReconciliation();
	if (!protection) return null;
	if (protection.error) throw new PublicationReconciliationError([], protection.error);
	let remote: string;
	try {
		remote = await getRemoteMain();
	} catch (caught) {
		throw new PublicationReconciliationError(protection.paths, `Cannot verify recovered remote paths; publishing remains blocked. ${caught instanceof Error ? caught.message : String(caught)}`);
	}
	const temporary = await mkdtemp(join(tmpdir(), 'cms-recovered-output-'));
	const env = { ...process.env, GIT_INDEX_FILE: join(temporary, 'index') };
	try {
		const initialized = await runGit(['read-tree', 'HEAD'], 10_000, { env });
		if (!initialized.ok) throw new PublicationReconciliationError(protection.paths, 'Cannot inspect candidate publication output; publishing remains blocked.');
		if (paths.length) {
			const added = await runGit(['add', '--', ...paths], 10_000, { env });
			if (!added.ok) throw new PublicationReconciliationError(protection.paths, 'Cannot prepare candidate publication output; publishing remains blocked.');
		}
		const diff = await runGit([
			'--no-replace-objects', 'diff', '--cached', '--name-only', '--no-renames', '--no-ext-diff', '--no-textconv',
			'--no-relative', '--ignore-submodules=none', '-z', remote, '--'
		], 10_000, { env, stdoutOnly: true, outputLimit: 4 * 1024 * 1024 });
		if (!diff.ok || diff.truncated) throw new PublicationReconciliationError(protection.paths, 'Cannot compare the complete candidate output with the remote. Publishing remains blocked; retry when Git and the remote are available.');
		const changed = new Set(diff.output.split('\0').filter(Boolean));
		const conflicts = protection.paths.filter((path) => changed.has(path));
		if (conflicts.length) throw new PublicationReconciliationError(conflicts,
			`Reconciliation required before publishing: candidate output would overwrite recovered remote changes at ${conflicts.join(', ')}. CMS publication records still include the historical posts. To keep remote removals, explicitly unpublish/delete and stage those posts. For edits, reconcile the site/CMS version or explicitly restore the reviewed state on the remote. Then retry publishing; no unpublication is inferred automatically.`);
		return saved;
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
};

export const finishPublicationReconciliation = (validated: string | null) => {
	assertCheckoutWriteLock();
	if (validated && getMetaValue(key) === validated) setMetaValue(key, '');
};
