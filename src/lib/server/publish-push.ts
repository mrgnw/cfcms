import { getMetaValue, setMetaValue } from './db';
import { getHeadCommit, runGit } from './git';
import { assertCheckoutWriteLock, CheckoutBusyError } from './checkout-lock';

const pendingPushKey = 'pendingPublishPush';
const backupPath = '.cms/cms-backup.db';
const descendantLimit = 100;

export const getPendingPublishPush = () => getMetaValue(pendingPushKey);
export const hasPendingPublishPush = () => Boolean(getPendingPublishPush());
export const setPendingPublishPush = (commit: string | null) => setMetaValue(pendingPushKey, commit ?? '');

export const assertNoPendingPublishMutation = (operation: string) => {
	if (hasPendingPublishPush()) {
		throw new CheckoutBusyError(`A publish push is pending. Retry the publish push before ${operation}.`);
	}
};

const isAncestor = async (ancestor: string, descendant: string) => {
	const result = await runGit(['merge-base', '--is-ancestor', ancestor, descendant]);
	if (result.status === 0) return true;
	if (result.status === 1) return false;
	throw new Error(`Cannot check pending publish ancestry: ${result.output}`);
};

export const assertPendingPublishTip = async () => {
	const pending = getPendingPublishPush();
	if (!pending) return;
	const head = await getHeadCommit();
	if (!head || !await isAncestor(pending, head)) {
		throw new Error('Blog HEAD no longer contains the pending publish; reconcile it before retrying');
	}
	const descendants = await runGit(['rev-list', `--max-count=${descendantLimit + 1}`, `${pending}..${head}`]);
	if (!descendants.ok) throw new Error(`Cannot inspect pending publish descendants: ${descendants.output}`);
	const commits = descendants.output.trim().split('\n').filter(Boolean);
	if (commits.length > descendantLimit) throw new Error('Too many commits after the pending publish; reconcile them before retrying');
	for (const commit of commits) {
		const identity = await runGit(['show', '-s', '--format=%P%n%s', commit]);
		const paths = await runGit(['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', commit]);
		const [parents, subject] = identity.output.trim().split('\n');
		if (!identity.ok || !paths.ok || parents.split(' ').length !== 1 || subject !== 'cms: db backup' ||
			paths.output !== `${backupPath}\0`) {
			throw new Error('Unrelated commits follow the pending publish; refusing to push them automatically');
		}
	}
};

export const reconcilePublishedPush = async () => {
	assertCheckoutWriteLock();
	const pending = getPendingPublishPush();
	if (!pending) return false;
	const fetched = await runGit(['fetch', '--no-tags', 'origin', '+refs/heads/main:refs/remotes/origin/main']);
	if (!fetched.ok) throw new Error(`Cannot check whether the publish was pushed: ${fetched.output}`);
	if (!await isAncestor(pending, 'refs/remotes/origin/main')) return false;
	setPendingPublishPush(null);
	return true;
};
