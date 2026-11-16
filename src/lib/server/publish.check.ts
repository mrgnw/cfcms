import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = mkdtempSync(join(tmpdir(), 'cms-publish-check-'));
const blog = join(root, 'blog');
const remote = join(root, 'remote.git');
const git = (...args: string[]) => execFileSync('git', ['-C', blog, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
execFileSync('git', ['init', '-q', '-b', 'main', blog]);
execFileSync('git', ['init', '-q', '--bare', remote]);
git('config', 'user.name', 'CMS Test');
git('config', 'user.email', 'cms-test@example.test');
git('config', 'commit.gpgsign', 'false');
git('remote', 'add', 'origin', remote);
mkdirSync(join(blog, 'content'));
mkdirSync(join(blog, 'src/posts'), { recursive: true });
writeFileSync(join(blog, 'src/posts/live.svx'), '---\ntitle: Live\ndate: 2026-01-01\npublished: true\n---\n\nLive body.\n');
git('add', '.');
git('commit', '-qm', 'initial live post');
git('push', '-qu', 'origin', 'main');
process.env.BLOG_CONTENT_BASE_DIR = blog;
process.env.BLOG_CMS_DB = join(root, 'cms.db');
process.env.BLOG_BUILD_COMMAND = `"${process.execPath}" "${fileURLToPath(new URL('./fixtures/build-worker.ts', import.meta.url))}"`;
process.chdir(root);

const { POST } = await import('../../routes/api/publish/+server.ts');
const { createPost, getPost, listPosts, savePost } = await import('./content.ts');
const { getPublishedPosts, getStagedPaths, setStaged, getStagedRevisions } = await import('./db.ts');
const { runBackup } = await import('./backup.ts');
const { CheckoutBusyError } = await import('./checkout-lock.ts');
const { getPendingChanges } = await import('./pending.ts');
const { hasPendingPublishPush } = await import('./publish.ts');
const fm = (title: string) => `title: ${title}\ndate: 2026-01-01\npublish: true`;
const publish = async () => {
	const response = await POST();
	return { status: response.status, data: await response.json() };
};

try {
	await listPosts();
	const first = await createPost(fm('First'), 'Approved first body.', 'cms');
	setStaged(first.path, true);
	process.env.CMS_CHECK_BUILD_MODE = 'wait';
	const active = publish();
	const deadline = Date.now() + 10_000;
	while (!existsSync(join(blog, 'build.started'))) {
		if (Date.now() > deadline) assert.fail('publish did not reach the build');
		await setTimeout(10);
	}
	const refused = await publish();
	assert.equal(refused.status, 409);
	assert.match(refused.data.message, /already running/);
	await assert.rejects(runBackup(), CheckoutBusyError);
	assert.ok((await getPendingChanges(await listPosts())).some((post) => post.path === first.path),
		'the publish view can load while rendering holds the checkout lock');
	const edit = await savePost(first.path, first.frontmatter, 'Edited while building.', first.contentHash, 'cms');
	setStaged(first.path, true);
	writeFileSync(join(blog, 'build.release'), '');
	const finished = await active;
	assert.equal(finished.status, 200, JSON.stringify(finished.data));
	assert.equal(getPublishedPosts()[first.path].hash, first.contentHash, 'only the captured approval ships');
	assert.equal((await getPost(first.path)).contentHash, edit.post.contentHash, 'the edit survives publishing');
	assert.ok(getStagedPaths().has(first.path), 'the newer restage survives publishing');
	assert.equal(git('show', 'HEAD:src/posts/first.svx').includes('Approved first body.'), true);
	assert.equal(git('show', 'HEAD:src/posts/first.svx').includes('Edited while building.'), false);

	process.env.CMS_CHECK_BUILD_MODE = 'success';
	assert.equal((await publish()).status, 200);
	assert.equal(getPublishedPosts()[first.path].hash, edit.post.contentHash);
	assert.ok(!getStagedRevisions().has(first.path));
	assert.equal(git('rev-parse', 'HEAD'), git('rev-parse', 'origin/main'));

	const stale = await createPost(fm('Stale'), 'Staged body.', 'cms');
	setStaged(stale.path, true);
	await savePost(stale.path, stale.frontmatter, 'Unapproved edit.', stale.contentHash, 'cms');
	const fresh = await createPost(fm('Fresh'), 'Fresh body.', 'cms');
	setStaged(fresh.path, true);
	const mixed = await publish();
	assert.equal(mixed.status, 200);
	assert.equal(mixed.data.stagedCount, 1);
	assert.ok(!getPublishedPosts()[stale.path], 'stale approvals do not ship in a mixed batch');
	assert.ok(!existsSync(join(blog, 'src/posts/stale.svx')));
	assert.ok(getStagedRevisions().has(stale.path), 'a stale approval stays visible until restaging');
	const staleChange = (await getPendingChanges(await listPosts())).find((post) => post.path === stale.path);
	assert.equal(staleChange?.staged, false);
	assert.equal(staleChange?.editedAfterStaging, true, 'the publish view explains why restaging is required');
	assert.deepEqual(mixed.data.editedAfterStaging, [stale.path]);
	const staleOnly = await publish();
	assert.equal(staleOnly.status, 409);
	assert.match(staleOnly.data.message, /Edited after staging; restage/);
	assert.deepEqual(staleOnly.data.editedAfterStaging, [stale.path]);

	setStaged(stale.path, true);
	const beforeFailure = git('rev-parse', 'HEAD');
	const publishedBeforeFailure = getPublishedPosts();
	const liveBeforeFailure = readFileSync(join(blog, 'src/posts/first.svx'), 'utf8');
	process.env.CMS_CHECK_BUILD_MODE = 'fail';
	rmSync(join(blog, 'src/lib/icons/build.svg'));
	writeFileSync(join(blog, 'src/lib/icons/keep.svg'), '<svg>keep</svg>');
	git('add', 'src/lib/icons/keep.svg');
	const indexBeforeFailure = readFileSync(join(blog, '.git/index'));
	const failed = await publish();
	assert.equal(failed.status, 502);
	assert.equal(git('rev-parse', 'HEAD'), beforeFailure);
	assert.deepEqual(getPublishedPosts(), publishedBeforeFailure);
	assert.ok(getStagedPaths().has(stale.path));
	assert.ok(!existsSync(join(blog, 'src/posts/stale.svx')), 'failed build removes new rendered svx');
	assert.ok(!existsSync(join(blog, 'content/stale.md')), 'failed build removes new boundary files');
	assert.ok(!existsSync(join(blog, 'src/lib/icons/build.svg')), 'failed build restores icon files');
	assert.equal(readFileSync(join(blog, 'src/lib/icons/keep.svg'), 'utf8'), '<svg>keep</svg>');
	assert.deepEqual(readFileSync(join(blog, '.git/index')), indexBeforeFailure, 'rollback preserves the exact prior Git index');
	assert.equal(readFileSync(join(blog, 'src/posts/first.svx'), 'utf8'), liveBeforeFailure);

	process.env.CMS_CHECK_BUILD_MODE = 'success';
	mkdirSync(join(blog, 'content/stale.md'));
	const renderFailure = await publish();
	assert.equal(renderFailure.status, 500);
	assert.match(renderFailure.data.message, /EISDIR/);
	assert.ok(!existsSync(join(blog, 'src/posts/stale.svx')), 'render exceptions also restore earlier writes');
	assert.deepEqual(readFileSync(join(blog, '.git/index')), indexBeforeFailure);
	rmSync(join(blog, 'content/stale.md'), { recursive: true });

	writeFileSync(join(blog, '.git/hooks/pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
	const commitFailure = await publish();
	assert.equal(commitFailure.status, 500);
	assert.match(commitFailure.data.message, /Publish commit failed/);
	assert.equal(git('rev-parse', 'HEAD'), beforeFailure);
	assert.deepEqual(readFileSync(join(blog, '.git/index')), indexBeforeFailure, 'failed commits undo git add');
	assert.deepEqual(getPublishedPosts(), publishedBeforeFailure);
	assert.ok(getStagedPaths().has(stale.path));
	assert.ok(!existsSync(join(blog, 'content/stale.md')));
	rmSync(join(blog, '.git/hooks/pre-commit'));

	writeFileSync(join(remote, 'hooks/pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
	const pushFailure = await publish();
	assert.equal(pushFailure.status, 502);
	assert.match(pushFailure.data.push.output, /Committed but not pushed/);
	assert.ok(getPublishedPosts()[stale.path], 'a failed push preserves the committed published state');
	assert.ok(!getStagedRevisions().has(stale.path), 'the committed approval is consumed');
	assert.notEqual(git('rev-parse', 'HEAD'), git('rev-parse', 'origin/main'));
	assert.equal(hasPendingPublishPush(), true, 'push retry remains available after reloading the view');
	const committedBeforeRetry = git('rev-parse', 'HEAD');
	rmSync(join(remote, 'hooks/pre-receive'));
	const retried = await publish();
	assert.equal(retried.status, 200, JSON.stringify(retried.data));
	assert.equal(retried.data.stagedCount, 0, 'retry pushes the committed snapshot without needing a new stage');
	assert.deepEqual(retried.data.results, [], 'retry does not rebuild');
	assert.equal(git('show', `${committedBeforeRetry}:src/posts/stale.svx`).includes('Unapproved edit.'), true);
	assert.equal(git('rev-parse', 'HEAD'), git('rev-parse', 'origin/main'));
	assert.equal(hasPendingPublishPush(), false);

	const live = await getPost(first.path);
	const unpublish = await savePost(first.path, live.frontmatter.replace('publish: true', 'publish: false'), live.body, live.contentHash, 'cms');
	setStaged(first.path, true);
	const staleUnpublish = await savePost(first.path, unpublish.post.frontmatter, 'Edited unpublish.', unpublish.post.contentHash, 'cms');
	assert.equal((await publish()).status, 409, 'unpublish approvals also become stale after edits');
	assert.ok(getPublishedPosts()[first.path]);
	setStaged(first.path, true);
	assert.equal((await publish()).status, 200);
	assert.ok(!getPublishedPosts()[first.path]);
	assert.ok(!existsSync(join(blog, 'src/posts/first.svx')));
	assert.ok(!existsSync(join(blog, 'content/first.md')));
	assert.equal((await getPost(first.path)).contentHash, staleUnpublish.post.contentHash, 'unpublish retains the stored draft');
	assert.equal(git('status', '--porcelain'), '?? build.release\n?? build.started');
	console.log('publish.check: ok');
} finally {
	delete process.env.CMS_CHECK_BUILD_MODE;
	rmSync(root, { recursive: true, force: true });
}
