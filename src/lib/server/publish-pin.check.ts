import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'cms-push-pin-'));
const blog = join(root, 'blog');
const remote = join(root, 'remote.git');
const git = (...args: string[]) => execFileSync('git', ['-C', blog, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
execFileSync('git', ['init', '-q', '-b', 'main', blog]);
execFileSync('git', ['init', '-q', '--bare', remote]);
git('config', 'user.name', 'CMS Test');
git('config', 'user.email', 'cms-test@example.test');
git('config', 'commit.gpgsign', 'false');
git('remote', 'add', 'origin', remote);
writeFileSync(join(blog, 'approved.txt'), 'Approved snapshot.');
git('add', 'approved.txt');
git('commit', '-qm', 'approved snapshot');
process.env.BLOG_CONTENT_BASE_DIR = blog;
process.env.BLOG_CMS_DB = join(root, 'cms.db');

const { withCheckoutLock } = await import('./checkout-lock.ts');
const { assertPendingPublishTip, setPendingPublishPush } = await import('./publish-push.ts');
const { pushContent } = await import('./git.ts');

try {
	const approved = git('rev-parse', 'HEAD');
	setPendingPublishPush(approved);
	await withCheckoutLock(async () => {
		const validated = await assertPendingPublishTip();
		writeFileSync(join(blog, 'operator.txt'), 'A later operator commit.');
		git('add', 'operator.txt');
		git('commit', '-qm', 'operator moved main after validation');
		assert.equal(validated, approved);
		assert.ok((await pushContent(validated!)).ok);
	});
	assert.equal(git('rev-parse', 'origin/main'), approved);
	assert.notEqual(git('rev-parse', 'HEAD'), approved);
	console.log('publish-pin.check: ok');
} finally {
	rmSync(root, { recursive: true, force: true });
}
