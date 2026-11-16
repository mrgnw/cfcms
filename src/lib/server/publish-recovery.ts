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
		minimumGitVersion: '2.43.0',
		pendingCommit: pending,
		message: pending === getMetaValue('publishRecoveryPending') ? getMetaValue(reportKey) : null,
		remoteCommit: pending && pending === getMetaValue('publishRecoveryPending') ? getMetaValue('publishRecoveryRemote') : null,
		lastDelivery: {
			capturedCommit: getMetaValue('publishDeliveryCaptured'),
			commit: getMetaValue('publishDeliveryCommit'),
			remote: getMetaValue('publishDeliveryRemote'),
			verifiedAt: getMetaValue('publishDeliveryVerifiedAt'),
			authorConfirmed: getMetaValue('publishDeliveryAuthorConfirmed') === 'true'
		}
	};
};

type SelectedDelivery = { commit: string; remote: string; confirmed: true };

const assertPublishedHistory = async (delivery: string, remote: string) => {
	if (delivery === remote) return;
	const history = await runGit(['rev-list', '--first-parent', '--parents', `${delivery}..${remote}`], 10_000,
		{ stdoutOnly: true });
	if (!history.ok) throw new Error(`Cannot inspect published main history: ${history.stderr ?? history.output}`);
	const output = history.output.trimEnd();
	const oldest = output.split('\n').at(-1)?.split(' ');
	if (history.truncated && !output.includes('\n') || !oldest || oldest[1] !== delivery) {
		throw new Error('The selected commit is not on the published first-parent history of main. A side-branch content match cannot establish delivery.');
	}
};

const verifySelectedDelivery = async (pending: string, delivery: string, remote: string) => {
	if (!await isAncestor(delivery, remote)) throw new Error('The selected delivery commit is not in the fetched remote history.');
	await assertPublishedHistory(delivery, remote);
	if (await isAncestor(delivery, pending)) throw new Error('Select the rewritten publication commit, not an earlier commit from the captured history.');
	const parents = await runGit(['rev-list', '--parents', '--max-count=1', delivery], 10_000);
	const family = parents.output.trim().split(' ');
	if (!parents.ok || parents.truncated || family.length < 2 || !family.every((commit) => commitPattern.test(commit))) {
		throw new Error('Select a commit with a readable first parent that completed delivery of the captured publication.');
	}
	const proof = await verifyRewrittenCommit(pending, delivery);
	if (proof.equivalent && (await verifyRewrittenCommit(pending, family[1])).equivalent) {
		throw new Error('The selected commit did not complete delivery; its parent already contains the captured changes. Select the actual delivery commit.');
	}
	return proof;
};

export const reconcilePublication = (expected: string, selected?: SelectedDelivery) => withCheckoutLock(async () => {
	const pending = getPendingPublishPush();
	if (!pending || expected !== pending) throw new CheckoutBusyError('Pending publication changed. Reload before verifying delivery.');
	if (selected && (!selected.confirmed || !commitPattern.test(selected.commit) || !commitPattern.test(selected.remote))) {
		throw new CheckoutBusyError('Confirm the full rewritten delivery commit and verified remote tip.');
	}
	if (selected && (getMetaValue('publishRecoveryPending') !== pending || getMetaValue('publishRecoveryRemote') !== selected.remote)) {
		throw new CheckoutBusyError('Verify current remote delivery before selecting a historical commit.');
	}
	const remote = await getRemoteMain();
	if (selected && selected.remote !== remote) throw new CheckoutBusyError('Remote main changed. Verify current delivery again before confirming a historical commit.');
	let proof = { equivalent: false, paths: [] as string[] };
	let failure = '';
	let deliveryCommit = selected?.commit ?? remote;
	try {
		await retainPushCommit('publication', pending);
		if (selected) proof = await verifySelectedDelivery(pending, selected.commit, remote);
		else if (await isAncestor(pending, remote)) {
			proof = { equivalent: true, paths: [] };
			deliveryCommit = pending;
		} else proof = await verifyRewrittenCommit(pending, remote);
	} catch (caught) {
		failure = caught instanceof Error ? caught.message : 'The captured commit could not be verified';
	}
	const report = {
		ok: proof.equivalent,
		pendingCommit: pending,
		remoteCommit: remote,
		deliveryCommit: proof.equivalent ? deliveryCommit : null,
		authorConfirmed: Boolean(selected),
		paths: proof.paths,
		verifiedAt: new Date().toISOString(),
		message: proof.equivalent
			? selected
				? `Delivery at your selected commit ${deliveryCommit} verified. Later remote edits were preserved. No post content or checkout files were changed.`
				: 'Remote delivery verified. No post content or checkout files were changed.'
			: `${failure ? `${failure}. ` : ''}Remote delivery is not verified. If a later remote edit replaced the delivered text, identify and explicitly confirm the rewritten publication commit on the Publish page. Matching content alone is not a delivery record. Otherwise, download the captured patch, review and apply it on a branch based on origin/main, resolve conflicts, and push the reviewed result without force. Then verify again. If the captured Git object is missing, restore it from a clone or backup first. Newer CMS edits remain saved.`,
		patchUrl: `/api/publish/reconcile?patch=${pending}`
	};
	setMetaValue(reportKey, report.message);
	setMetaValue('publishRecoveryPending', pending);
	setMetaValue('publishRecoveryRemote', remote);
	if (proof.equivalent) {
		setMetaValue('publishDeliveryCaptured', pending);
		setMetaValue('publishDeliveryCommit', deliveryCommit);
		setMetaValue('publishDeliveryRemote', remote);
		setMetaValue('publishDeliveryVerifiedAt', report.verifiedAt);
		setMetaValue('publishDeliveryAuthorConfirmed', selected ? 'true' : 'false');
		setPendingPublishPush(null);
	}
	return report;
});

export const readPendingPublicationPatch = async (expected: string) => {
	if (!commitPattern.test(expected) || expected !== getPendingPublishPush()) {
		throw new CheckoutBusyError('Pending publication changed. Reload before downloading its patch.');
	}
	const base = await runGit(['merge-base', '--all', expected, 'refs/remotes/origin/main'], 10_000);
	if (!base.ok || !commitPattern.test(base.output.trim())) {
		throw new Error('Cannot identify the complete captured change. Verify remote delivery first. Restore any missing Git objects from a clone or backup; inspect ambiguous history manually.');
	}
	const patch = await runGit([
		'diff', '--binary', '--full-index', '--no-ext-diff', '--no-textconv', '--no-renames', '--no-color',
		'--src-prefix=a/', '--dst-prefix=b/', '--no-relative', base.output.trim(), expected, '--'
	], 15_000, { outputLimit: 4 * 1024 * 1024, keepStart: true, stdoutOnly: true });
	if (!patch.ok) throw new Error(`Cannot export the captured publication patch: ${patch.stderr ?? patch.output}`);
	if (patch.truncated) {
		throw new Error(`The patch exceeds the 4 MiB download limit. Export the complete binary Git diff from ${base.output.trim()} to ${expected}, review it against origin/main, then verify delivery again.`);
	}
	return patch.output;
};
