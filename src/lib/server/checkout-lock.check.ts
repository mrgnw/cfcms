import assert from 'node:assert/strict';
import { execFileSync, fork } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

const root = mkdtempSync(join(tmpdir(), 'cms-lock-check-'));
execFileSync('git', ['init', '-q', '-b', 'main', root]);
process.env.BLOG_CONTENT_BASE_DIR = root;
process.env.BLOG_CMS_DB = join(root, 'cms.db');
const { withCheckoutLock, withCheckoutReadLock, CheckoutBusyError } = await import('./checkout-lock.ts');
const { commitPaths, pushContent } = await import('./git.ts');

const worker = (mode = 'write') => fork(new URL('./fixtures/checkout-worker.ts', import.meta.url), [mode], {
	env: process.env,
	execArgv: ['--disable-warning=ExperimentalWarning', '--import', new URL('../../../scripts/check-hooks.ts', import.meta.url).href],
	stdio: ['ignore', 'pipe', 'pipe', 'ipc']
});

let child: ReturnType<typeof worker> | null = null;
try {
	const entered = Promise.withResolvers<void>();
	const finish = Promise.withResolvers<void>();
	const active = withCheckoutLock(async () => {
		entered.resolve();
		await finish.promise;
	});
	await assert.rejects(withCheckoutLock(async () => undefined), CheckoutBusyError);
	await entered.promise;
	await assert.rejects(withCheckoutReadLock(async () => assert.fail('must not inspect a rendered tree')), CheckoutBusyError);
	finish.resolve();
	await active;
	await assert.rejects(withCheckoutLock(async () => { throw new Error('operation failed'); }), /operation failed/);
	await withCheckoutLock(async () => undefined);
	const inspectionStarted = Promise.withResolvers<void>();
	const finishInspection = Promise.withResolvers<void>();
	const inspection = withCheckoutReadLock(async () => {
		inspectionStarted.resolve();
		await finishInspection.promise;
	});
	await inspectionStarted.promise;
	let published = false;
	const waitingPublish = withCheckoutLock(async () => { published = true; return 'published'; });
	await setTimeout(50);
	assert.equal(published, false, 'inspection keeps the writer outside the checkout');
	finishInspection.resolve();
	await inspection;
	assert.equal(await waitingPublish, 'published', 'a publish waits for page inspection instead of returning a false conflict');

	child = worker('read');
	await once(child, 'message', { signal: AbortSignal.timeout(10_000) });
	const waitingForProcess = withCheckoutLock(async () => 'published');
	await setTimeout(50);
	const inspectionExit = once(child, 'exit');
	child.send('finish');
	await inspectionExit;
	child = null;
	assert.equal(await waitingForProcess, 'published', 'a publish also waits for another process inspecting the checkout');
	await assert.rejects(commitPaths([], 'must not write'), /requires the write lock/);
	await assert.rejects(pushContent(), /requires the write lock/);

	child = worker();
	assert.deepEqual(await once(child, 'message', { signal: AbortSignal.timeout(10_000) }), ['locked', undefined]);
	await assert.rejects(withCheckoutLock(async () => assert.fail('must not enter')), CheckoutBusyError);
	const exited = once(child, 'exit');
	child.kill('SIGKILL');
	await exited;
	child = null;
	assert.ok(existsSync(join(root, '.git/cms-publish.lock')), 'a crashed owner leaves the lock file behind');
	await withCheckoutLock(async () => undefined);
	assert.ok(existsSync(join(root, '.git/cms-publish.lock')), 'recovery reuses the same lock file without unlink races');

	rmSync(join(root, '.git'), { recursive: true });
	await assert.rejects(withCheckoutLock(async () => undefined), /Cannot locate publish lock/);
	execFileSync('git', ['init', '-q', '-b', 'main', root]);
	await withCheckoutLock(async () => undefined);
	console.log('checkout-lock.check: ok');
} finally {
	if (child) {
		const exited = once(child, 'exit');
		child.kill('SIGKILL');
		await exited;
	}
	rmSync(root, { recursive: true, force: true });
}
