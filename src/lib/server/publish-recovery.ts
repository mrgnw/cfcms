import { withCheckoutLock, CheckoutBusyError } from './checkout-lock';
import { getMetaValue, setMetaValue } from './db';
import { retainPushCommit, runGit } from './git';
import { verifyRewrittenCommit } from './git-proof';
import { getPendingPublishPush, getRemoteMain, isAncestor, setPendingPublishPush } from './publish-push';

const commitPattern = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const reportKey = 'publishRecoveryMessage';

export const getPublicationRecovery = () => {
	const pending = getPendingPublishPush();
	return {
		pendingCommit: pending,
		message: pending === getMetaValue('publishRecoveryPending') ? getMetaValue(reportKey) : null
	};
};

export const reconcilePublication = (expected: string) => withCheckoutLock(async () => {
	const pending = getPendingPublishPush();
	if (!pending || expected !== pending) throw new CheckoutBusyError('Pending publication changed. Reload before verifying delivery.');
	const remote = await getRemoteMain();
	let proof = { equivalent: false, paths: [] as string[] };
	let failure = '';
	try {
		await retainPushCommit('publication', pending);
		proof = await isAncestor(pending, remote)
			? { equivalent: true, paths: [] }
			: await verifyRewrittenCommit(pending, remote);
	} catch (caught) {
		failure = caught instanceof Error ? caught.message : 'The captured commit could not be verified';
	}
	const report = {
		ok: proof.equivalent,
		pendingCommit: pending,
		remoteCommit: remote,
		paths: proof.paths,
		verifiedAt: new Date().toISOString(),
		message: proof.equivalent
			? 'Remote delivery verified. No post content or checkout files were changed.'
			: `${failure ? `${failure}. ` : ''}Remote delivery is not verified. Download the captured patch, review and apply it on a branch based on origin/main, resolve conflicts, and push the reviewed result without force. Then verify again. If the captured Git object is missing, restore it from a clone or backup first. Newer CMS edits remain saved.`,
		patchUrl: `/api/publish/reconcile?patch=${pending}`
	};
	setMetaValue(reportKey, report.message);
	setMetaValue('publishRecoveryPending', pending);
	if (proof.equivalent) setPendingPublishPush(null);
	return report;
});

export const readPendingPublicationPatch = async (expected: string) => {
	if (!commitPattern.test(expected) || expected !== getPendingPublishPush()) {
		throw new CheckoutBusyError('Pending publication changed. Reload before downloading its patch.');
	}
	const patch = await runGit([
		'-c', 'color.ui=false', 'show', '--binary', '--full-index', '--no-ext-diff', '--no-textconv', '--format=', expected
	], 15_000, { outputLimit: 4 * 1024 * 1024, keepStart: true, stdoutOnly: true });
	if (!patch.ok) throw new Error(`Cannot export the captured publication patch: ${patch.stderr ?? patch.output}`);
	if (patch.truncated) {
		throw new Error(`The patch exceeds the 4 MiB download limit. Export the full captured commit ${expected} with Git show --binary, review it against origin/main, then verify delivery again.`);
	}
	return patch.output;
};
