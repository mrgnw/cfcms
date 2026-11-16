import { getMetaValue, setMetaValue } from './db';
import { getHeadCommit, runGit } from './git';
import { assertCheckoutWriteLock, CheckoutBusyError } from './checkout-lock';

const pendingPushKey = 'pendingPublishPush';
const backupPath = '.cms/cms-backup.db';
const historyTimeoutMs = 10_000;

export const getPendingPublishPush = () => getMetaValue(pendingPushKey);
export const hasPendingPublishPush = () => Boolean(getPendingPublishPush());
export const setPendingPublishPush = (commit: string | null) => setMetaValue(pendingPushKey, commit ?? '');

export const assertNoPendingPublishMutation = (operation: string) => {
	if (hasPendingPublishPush()) {
		throw new CheckoutBusyError(`A publish push is pending. Retry the publish push before ${operation}.`);
	}
};

export const isAncestor = async (ancestor: string, descendant: string) => {
	const result = await runGit(['merge-base', '--is-ancestor', ancestor, descendant], historyTimeoutMs);
	if (result.status === 0) return true;
	if (result.status === 1) return false;
	throw new Error(`Cannot check pending publish ancestry: ${result.output}`);
};

export const assertPendingPublishTip = async () => {
	const pending = getPendingPublishPush();
	if (!pending) return null;
	const head = await getHeadCommit();
	if (head === pending) return head;
	if (!head || !await isAncestor(pending, head)) {
		throw new Error('Blog HEAD no longer contains the pending publish. Use Verify remote delivery on the Publish page after manual Git recovery. If delivery is unverified, download and review the captured patch.');
	}
	const range = `${pending}..${head}`;
	const merges = await runGit(['rev-list', '--max-count=1', '--min-parents=2', range], historyTimeoutMs);
	const unrelated = await runGit([
		'rev-list', '--full-history', '--max-count=1', range, '--', '.', `:(top,glob,exclude)${backupPath}`
	], historyTimeoutMs);
	const nestedBackupPaths = await runGit([
		'rev-list', '--full-history', '--max-count=1', range, '--', `${backupPath}/*`
	], historyTimeoutMs);
	if (!merges.ok || !unrelated.ok || !nestedBackupPaths.ok) {
		throw new Error(`Cannot inspect pending publish descendants: ${merges.output}${unrelated.output}${nestedBackupPaths.output}`);
	}
	if (merges.output.trim() || unrelated.output.trim() || nestedBackupPaths.output.trim()) {
		throw new Error('Unrelated commits follow the pending publish; refusing to push them automatically. Use Verify remote delivery on the Publish page after manual Git recovery.');
	}
	return head;
};

export const getRemoteMain = async () => {
	assertCheckoutWriteLock();
	const fetched = await runGit(['fetch', '--no-tags', 'origin', '+refs/heads/main:refs/remotes/origin/main'], 30_000);
	if (!fetched.ok) throw new Error(`Cannot check whether the commit was pushed: ${fetched.output}`);
	const remote = await runGit(['rev-parse', 'refs/remotes/origin/main'], 10_000);
	if (!remote.ok) throw new Error('Cannot read fetched origin/main');
	return remote.output.trim();
};

export const isCommitOnRemoteMain = async (commit: string) => isAncestor(commit, await getRemoteMain());

export const reconcilePublishedPush = async () => {
	const pending = getPendingPublishPush();
	if (!pending) return false;
	if (!await isCommitOnRemoteMain(pending)) return false;
	setPendingPublishPush(null);
	return true;
};
