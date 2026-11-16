import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'cms-recovered-protection-'));
const blog = join(root, 'blog');
const remote = join(root, 'remote.git');
const git = (...args: string[]) => execFileSync('git', ['-C', blog, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
execFileSync('git', ['init', '-q', '-b', 'main', blog]);
execFileSync('git', ['init', '-q', '--bare', remote]);
git('config', 'user.name', 'CMS Test');
git('config', 'user.email', 'cms-test@example.test');
git('config', 'commit.gpgsign', 'false');
writeFileSync(join(blog, 'protected.md'), 'Before publication.\n');
writeFileSync(join(blog, 'other.md'), 'Unrelated post.\n');
git('add', '.');
git('commit', '-qm', 'base');
const base = git('rev-parse', 'HEAD');
writeFileSync(join(blog, 'protected.md'), 'Captured publication.\n');
git('commit', '-qam', 'captured publication');
const captured = git('rev-parse', 'HEAD');
writeFileSync(join(blog, 'protected.md'), 'Remote author choice.\n');
git('commit', '-qam', 'remote changed after delivery');
const remoteTip = git('rev-parse', 'HEAD');
git('remote', 'add', 'origin', remote);
git('push', '-qu', 'origin', 'main');
process.env.BLOG_CONTENT_BASE_DIR = blog;
process.env.BLOG_CMS_DB = join(root, 'cms.db');
const { withCheckoutLock } = await import('./checkout-lock.ts');
const { commitPaths } = await import('./git.ts');
const { setMetaValue } = await import('./db.ts');
const { assertRecoveredPathsPreserved, finishPublicationReconciliation,
	getPublicationReconciliation, protectRecoveredPublication, approveRecoveredOutput } = await import('./publish-protection.ts');

try {
	await withCheckoutLock(async () => protectRecoveredPublication({
		capturedCommit: captured, remoteCommit: remoteTip, baseCommit: base,
		differences: [{ path: 'protected.md', kind: 'modified', matchesBefore: false }]
	}));
	writeFileSync(join(blog, 'protected.md'), 'Captured publication.\n');
	await assert.rejects(withCheckoutLock(() => assertRecoveredPathsPreserved(['protected.md'])), /Reconciliation required/);
	git('commit', '-qam', 'local restoration not approved on remote');
	const local = git('rev-parse', 'HEAD');
	writeFileSync(join(blog, 'protected.md'), 'Remote author choice.\n');
	git('add', 'protected.md');
	writeFileSync(join(blog, 'other.md'), 'An unrelated staged change.\n');
	const index = readFileSync(join(blog, '.git/index'));
	await assert.rejects(withCheckoutLock(() => assertRecoveredPathsPreserved(['other.md'])), /Reconciliation required/,
		'an excluded staged fix cannot mask the protected content inherited by an unrelated path-only commit');
	await assert.rejects(withCheckoutLock(() => assertRecoveredPathsPreserved([])), /Reconciliation required/);
	assert.equal(git('rev-parse', 'HEAD'), local);
	assert.deepEqual(readFileSync(join(blog, '.git/index')), index);
	assert.deepEqual(getPublicationReconciliation()?.paths, ['protected.md']);
	git('reset', '--hard', 'origin/main');
	writeFileSync(join(blog, 'other.md'), 'Reviewed unrelated update.\n');
	git('remote', 'set-url', 'origin', join(root, 'unavailable.git'));
	await assert.rejects(withCheckoutLock(() => assertRecoveredPathsPreserved(['other.md'])), /publishing remains blocked/);
	assert.ok(getPublicationReconciliation());
	git('remote', 'set-url', 'origin', remote);
	await withCheckoutLock(async () => {
		let validated: string | null = null;
		const result = await commitPaths(['other.md'], 'reviewed publish', async (paths) => {
			validated = await assertRecoveredPathsPreserved(paths);
		});
		assert.equal(result.ok, true);
		assert.ok(getPublicationReconciliation(), 'validation alone does not clear protection');
		finishPublicationReconciliation(validated);
	});
	assert.equal(getPublicationReconciliation(), null);
	assert.equal(git('show', 'HEAD:protected.md'), 'Remote author choice.');
	await withCheckoutLock(async () => protectRecoveredPublication({
		capturedCommit: captured, remoteCommit: remoteTip, baseCommit: base,
		differences: [{ path: 'protected.md', kind: 'modified', matchesBefore: false }]
	}));
	writeFileSync(join(blog, 'protected.md'), 'Reviewed intentional rendering.\n');
	await assert.rejects(withCheckoutLock(() => assertRecoveredPathsPreserved(['protected.md'])), /Reconciliation required/);
	const firstReview = getPublicationReconciliation()!.review!;
	assert.match(firstReview.patch, /-Remote author choice/);
	assert.match(firstReview.patch, /\+Reviewed intentional rendering/);
	assert.equal(firstReview.approved, false);
	await assert.rejects(approveRecoveredOutput('0'.repeat(64), remoteTip), /stale/);
	setMetaValue('pendingPublishPush', captured);
	await assert.rejects(approveRecoveredOutput(firstReview.token, firstReview.remoteCommit), /publish push is pending/);
	setMetaValue('pendingPublishPush', '');
	const beforeApproval = readFileSync(join(blog, '.git/index'));
	await approveRecoveredOutput(firstReview.token, firstReview.remoteCommit);
	assert.deepEqual(readFileSync(join(blog, '.git/index')), beforeApproval);
	assert.equal(getPublicationReconciliation()!.review!.approved, true);
	assert.ok(getPublicationReconciliation(), 'approval never clears the guard');
	writeFileSync(join(blog, 'protected.md'), 'Changed after reviewing.\n');
	await assert.rejects(withCheckoutLock(() => assertRecoveredPathsPreserved(['protected.md'])), /Reconciliation required/);
	const secondReview = getPublicationReconciliation()!.review!;
	assert.notEqual(secondReview.token, firstReview.token);
	assert.equal(secondReview.approved, false, 'changed output cannot reuse approval');
	await assert.rejects(approveRecoveredOutput(firstReview.token, firstReview.remoteCommit), /stale/);
	writeFileSync(join(blog, 'other.md'), 'Local commit after preview.\n');
	git('add', 'other.md');
	git('commit', '-qm', 'invalidate local review commit', '--', 'other.md');
	await assert.rejects(approveRecoveredOutput(secondReview.token, secondReview.remoteCommit), /changed/);
	await assert.rejects(withCheckoutLock(() => assertRecoveredPathsPreserved(['protected.md'])), /Reconciliation required/);
	const remoteReview = getPublicationReconciliation()!.review!;
	execFileSync('git', ['-C', remote, 'update-ref', 'refs/heads/main', base]);
	await assert.rejects(approveRecoveredOutput(remoteReview.token, remoteReview.remoteCommit), /changed/);
	assert.equal(getPublicationReconciliation()!.review, null);
	assert.ok(getPublicationReconciliation(), 'stale remote never releases protection');
	execFileSync('git', ['-C', remote, 'update-ref', 'refs/heads/main', remoteTip]);
	await assert.rejects(withCheckoutLock(() => assertRecoveredPathsPreserved(['protected.md'])), /Reconciliation required/);
	const thirdReview = getPublicationReconciliation()!.review!;
	await approveRecoveredOutput(thirdReview.token, thirdReview.remoteCommit);
	execFileSync('git', ['-C', remote, 'update-ref', 'refs/heads/main', base]);
	await assert.rejects(withCheckoutLock(() => assertRecoveredPathsPreserved(['protected.md'])), /Reconciliation required/);
	assert.equal(getPublicationReconciliation()!.review!.approved, false, 'remote changes after approval must be reviewed again');
	execFileSync('git', ['-C', remote, 'update-ref', 'refs/heads/main', remoteTip]);
	await assert.rejects(withCheckoutLock(() => assertRecoveredPathsPreserved(['protected.md'])), /Reconciliation required/);
	const finalReview = getPublicationReconciliation()!.review!;
	await approveRecoveredOutput(finalReview.token, finalReview.remoteCommit);
	await withCheckoutLock(async () => {
		let validated: string | null = null;
		assert.equal((await commitPaths(['protected.md'], 'explicitly reviewed output', async (paths) => {
			validated = await assertRecoveredPathsPreserved(paths);
		})).ok, true);
		finishPublicationReconciliation(validated);
	});
	assert.equal(getPublicationReconciliation(), null);
	assert.equal(git('show', 'HEAD:protected.md'), 'Changed after reviewing.');
	await withCheckoutLock(async () => protectRecoveredPublication({
		capturedCommit: captured, remoteCommit: remoteTip, baseCommit: base,
		differences: [{ path: 'protected.md', kind: 'modified', matchesBefore: false }]
	}));
	writeFileSync(join(blog, 'protected.md'), Buffer.from([0, 1, 2, 3]));
	await assert.rejects(withCheckoutLock(() => assertRecoveredPathsPreserved(['protected.md'])), /too large, or binary/);
	assert.equal(getPublicationReconciliation()!.review, null, 'binary output cannot be implicitly accepted');
	writeFileSync(join(blog, 'protected.md'), 'Unreviewably large change.\n'.repeat(20_000));
	await assert.rejects(withCheckoutLock(() => assertRecoveredPathsPreserved(['protected.md'])), /too large, or binary/);
	assert.equal(getPublicationReconciliation()!.review, null, 'truncated patches cannot be approved');
	setMetaValue('publishRecoveryReconciliation', 'invalid');
	await assert.rejects(withCheckoutLock(() => assertRecoveredPathsPreserved(['other.md'])), /protection is invalid/);
	console.log('publish-protection.check: ok');
} finally {
	rmSync(root, { recursive: true, force: true });
}
