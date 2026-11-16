import assert from 'node:assert/strict';
import { execFileSync, fork } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'cms-lock-check-'));
execFileSync('git', ['init', '-q', '-b', 'main', root]);
process.env.BLOG_CONTENT_BASE_DIR = root;
process.env.BLOG_CMS_DB = join(root, 'cms.db');
const { withCheckoutLock, CheckoutBusyError } = await import('./checkout-lock.ts');

const worker = () => fork(new URL('./fixtures/checkout-worker.ts', import.meta.url), [], {
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
	finish.resolve();
	await active;
	await assert.rejects(withCheckoutLock(async () => { throw new Error('operation failed'); }), /operation failed/);
	await withCheckoutLock(async () => undefined);

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
