import type { PublicationOutputReview, PublicationReconciliation, PublicationRemoteState } from '#lib/types.js';
import { assertCheckoutWriteLock, CheckoutBusyError, withCheckoutLock } from './checkout-lock';
import { getMetaValue, setMetaValue } from './db';
import { getHeadCommit, runGit } from './git';
import { assertNoPendingPublishMutation, getRemoteMain } from './publish-push';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const key = 'publishRecoveryReconciliation';
const reviewKey = 'publishRecoveryOutputReview';
const approvalKey = 'publishRecoveryOutputApproval';
const reviewLimit = 256 * 1024;
const commitPattern = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
type SavedReview = Omit<PublicationOutputReview, 'approved'> & { guard: string; head: string };

const reviewToken = (review: Omit<SavedReview, 'token'>) => digest(JSON.stringify(review));

const readOutputReview = (guard: string): SavedReview | null => {
	try {
		const { token, ...review } = JSON.parse(getMetaValue(reviewKey) ?? '') as SavedReview;
		if (review.guard !== digest(guard) || !commitPattern.test(review.head)
			|| !commitPattern.test(review.remoteCommit) || !commitPattern.test(review.candidateTree)
			|| !Array.isArray(review.paths) || !review.paths.length
			|| !review.paths.every((path) => typeof path === 'string' && path.length)
			|| typeof review.patch !== 'string' || !review.patch || Buffer.byteLength(review.patch) > reviewLimit
			|| token !== reviewToken(review)) return null;
		return { token, ...review };
	} catch {
		return null;
	}
};

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
		const review = readOutputReview(saved);
		return { ...state, error: null, review: review ? {
			token: review.token, remoteCommit: review.remoteCommit, candidateTree: review.candidateTree,
			paths: review.paths, patch: review.patch, approved: getMetaValue(approvalKey) === review.token
		} : null };
	} catch {
		return { capturedCommit: null, remoteCommit: null, paths: [], review: null, error: 'Saved publication reconciliation protection is invalid. Restore its metadata from backup before publishing.' };
	}
};

export const approveRecoveredOutput = (token: string, remote: string) => withCheckoutLock(async () => {
	assertNoPendingPublishMutation('approving recovered output');
	const saved = getMetaValue(key);
	const review = saved ? readOutputReview(saved) : null;
	if (!review || review.token !== token || review.remoteCommit !== remote) {
		throw new CheckoutBusyError('This output review is stale. Retry publishing to generate the current protected-path patch, then review it again.');
	}
	if (await getRemoteMain() !== review.remoteCommit || await getHeadCommit() !== review.head) {
		setMetaValue(approvalKey, '');
		setMetaValue(reviewKey, '');
		throw new CheckoutBusyError('The remote or local commit changed after the output preview. Retry publishing and review the fresh patch.');
	}
	setMetaValue(approvalKey, review.token);
	return { ok: true, message: 'Exact protected output approved. Retry publishing; approval is checked against the remote and regenerated candidate before commit. No files were changed or pushed.' };
});

const reviewConflictingOutput = async (saved: string, remote: string, paths: string[], env: NodeJS.ProcessEnv) => {
	const tree = await runGit(['write-tree'], 10_000, { env });
	const head = await getHeadCommit();
	if (!tree.ok || !head || !commitPattern.test(tree.output.trim())) {
		throw new PublicationReconciliationError(paths, 'Cannot capture the complete candidate output for review. Publishing remains blocked.');
	}
	const candidateTree = tree.output.trim();
	const patch = await runGit([
		'--no-replace-objects', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames',
		'--no-relative', '--ignore-submodules=none', '--binary', '--full-index', remote, candidateTree,
		'--', ...paths.map((path) => `:(top,literal)${path}`)
	], 10_000, { stdoutOnly: true, outputLimit: reviewLimit });
	if (!patch.ok || patch.truncated || !patch.output || patch.output.includes('\nGIT binary patch\n')) {
		throw new PublicationReconciliationError(paths, 'The protected-output patch is unavailable, too large, or binary. Publishing remains blocked; reconcile these paths explicitly in Git/CMS, then retry.');
	}
	const review = { guard: digest(saved), head, remoteCommit: remote, candidateTree, paths, patch: patch.output };
	const token = reviewToken(review);
	if (getMetaValue(approvalKey) === token && readOutputReview(saved)?.token === token) return;
	setMetaValue(approvalKey, '');
	setMetaValue(reviewKey, JSON.stringify({ token, ...review }));
	throw new PublicationReconciliationError(paths,
		`Reconciliation required before publishing: candidate output would overwrite recovered remote changes at ${paths.join(', ')}. To keep remote removals, explicitly unpublish/delete and stage those posts. For edits or rendering changes, reconcile CMS/remote content or review and explicitly approve the exact protected-output patch on the Publish page. Nothing is automatically unpublished or accepted.`);
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
		if (conflicts.length) await reviewConflictingOutput(saved!, remote, conflicts, env);
		return saved;
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
};

export const finishPublicationReconciliation = (validated: string | null) => {
	assertCheckoutWriteLock();
	if (validated && getMetaValue(key) === validated) {
		setMetaValue(key, '');
		setMetaValue(reviewKey, '');
		setMetaValue(approvalKey, '');
	}
};
