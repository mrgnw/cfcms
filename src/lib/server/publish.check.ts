import assert from 'node:assert/strict';
import { execFileSync, fork } from 'node:child_process';
import { once } from 'node:events';
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
const { createPost, getPost, listPosts, purgePost, savePost } = await import('./content.ts');
const {
	getMetaValue, getPublishedPosts, getStagedPaths, setStaged, getStagedRevisions, listVersions, setTriageField, setMetaValue
} = await import('./db.ts');
const { runBackup } = await import('./backup.ts');
const { CheckoutBusyError, withCheckoutReadLock } = await import('./checkout-lock.ts');
const { getPendingChanges } = await import('./pending.ts');
const { hasPendingPublishPush } = await import('./publish.ts');
const { setPendingPublishPush } = await import('./publish-push.ts');
const fm = (title: string) => `title: ${title}\ndate: 2026-01-01\npublish: true`;
const publish = async () => {
	const response = await POST();
	return { status: response.status, data: await response.json() };
};

const waitForBuild = async () => {
	const deadline = Date.now() + 10_000;
	while (!existsSync(join(blog, 'build.started'))) {
		if (Date.now() > deadline) assert.fail('publish did not reach the build');
		await setTimeout(10);
	}
};

const runContender = async (mode: string, database: string, path = '') => {
	const child = fork(new URL('./fixtures/checkout-worker.ts', import.meta.url), [mode, path], {
		env: { ...process.env, BLOG_CMS_DB: database },
		execArgv: ['--disable-warning=ExperimentalWarning', '--import', new URL('../../../scripts/check-hooks.ts', import.meta.url).href],
		stdio: ['ignore', 'pipe', 'pipe', 'ipc']
	});
	const exited = once(child, 'exit');
	try {
		const [message] = await once(child, 'message', { signal: AbortSignal.timeout(10_000) });
		await exited;
		return message;
	} finally {
		if (child.exitCode === null) {
			child.kill('SIGKILL');
			await exited;
		}
	}
};

try {
	await Promise.all([listPosts(), listPosts()]);
	const first = await createPost(fm('First'), 'Approved first body.', 'cms');
	setStaged(first.path, true);
	process.env.CMS_CHECK_BUILD_MODE = 'wait';
	const pageInspectionStarted = Promise.withResolvers<void>();
	const finishPageInspection = Promise.withResolvers<void>();
	const pageInspection = withCheckoutReadLock(async () => {
		pageInspectionStarted.resolve();
		await finishPageInspection.promise;
	});
	await pageInspectionStarted.promise;
	const active = publish();
	await setTimeout(50);
	finishPageInspection.resolve();
	await pageInspection;
	await waitForBuild();
	const refused = await publish();
	assert.equal(refused.status, 409);
	assert.match(refused.data.message, /already running/);
	await assert.rejects(runBackup(), CheckoutBusyError);
	assert.ok((await getPendingChanges(await listPosts())).some((post) => post.path === first.path),
		'the publish view can load while rendering holds the checkout lock');
	const edit = await savePost(first.path, first.frontmatter, 'Edited while building.', first.contentHash, 'cms');
	const triage = setTriageField(first.path, 'nextStep', 'Review after publishing', null);
	const storedDuringBuild = (await listPosts()).find((post) => post.path === first.path);
	assert.equal(storedDuringBuild?.nextStep, 'Review after publishing');
	assert.equal(storedDuringBuild?.triageRev, triage.rev, 'the stored fallback preserves triage metadata from main');
	assert.ok(!listVersions(first.path).some((version) => version.writer === 'ext'),
		'listing posts during a build does not ingest transient boundary files as external edits');
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
	process.env.CMS_CHECK_BUILD_MODE = 'wait-fail';
	rmSync(join(blog, 'build.started'));
	rmSync(join(blog, 'build.release'));
	rmSync(join(blog, 'src/lib/icons/build.svg'));
	writeFileSync(join(blog, 'src/lib/icons/keep.svg'), '<svg>keep</svg>');
	git('add', 'src/lib/icons/keep.svg');
	const indexBeforeFailure = readFileSync(join(blog, '.git/index'));
	const failingPublish = publish();
	await waitForBuild();
	const freshBoundary = readFileSync(join(blog, 'content/fresh.md'), 'utf8');
	await assert.rejects(purgePost(fresh.path), CheckoutBusyError);
	assert.equal((await runContender('purge', join(root, 'cms.db'), fresh.path)).busy, true);
	for (const mode of ['baseline', 'import']) {
		assert.deepEqual(await runContender(mode, join(root, `${mode}-contender.db`)), {
			ok: false, busy: true, posts: 0
		}, `${mode} cannot read or mutate the half-rendered checkout from another process`);
	}
	assert.deepEqual(readFileSync(join(blog, '.git/index')), indexBeforeFailure, 'contending writers cannot mutate the captured index');
	writeFileSync(join(blog, 'build.release'), '');
	const failed = await failingPublish;
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
	assert.equal(readFileSync(join(blog, 'content/fresh.md'), 'utf8'), freshBoundary);
	assert.equal((await getPost(fresh.path)).contentHash, fresh.contentHash, 'a refused purge leaves its database row intact');

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
	const lastBackupBeforeFailure = getMetaValue('lastBackupAt');
	await assert.rejects(runBackup(), /Backup commit failed/);
	assert.equal(git('rev-parse', 'HEAD'), beforeFailure);
	assert.equal(getMetaValue('lastBackupAt'), lastBackupBeforeFailure, 'failed backup commits do not advance the backup timestamp');
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
	const boundaryBeforePendingPurge = readFileSync(join(blog, 'content/fresh.md'));
	const indexBeforePendingPurge = readFileSync(join(blog, '.git/index'));
	await assert.rejects(purgePost(fresh.path), /publish push is pending/);
	assert.equal(git('rev-parse', 'HEAD'), committedBeforeRetry);
	assert.deepEqual(readFileSync(join(blog, 'content/fresh.md')), boundaryBeforePendingPurge);
	assert.deepEqual(readFileSync(join(blog, '.git/index')), indexBeforePendingPurge);
	assert.equal((await getPost(fresh.path)).contentHash, fresh.contentHash);
	await assert.rejects(runBackup(), /publish push is pending/);
	assert.equal(getMetaValue('lastBackupAt'), lastBackupBeforeFailure, 'rejected backup pushes do not advance the backup timestamp');
	assert.equal(git('rev-parse', 'HEAD'), committedBeforeRetry, 'backups cannot advance a pending publish');
	for (let legacy = 0; legacy < 105; legacy += 1) {
		writeFileSync(join(blog, '.cms/cms-backup.db'), `legacy backup ${legacy}`);
		git('add', '.cms/cms-backup.db');
		git('commit', '-qm', 'cms: db backup');
	}
	const backupTip = git('rev-parse', 'HEAD');
	const remoteBeforeRetry = git('rev-parse', 'origin/main');
	rmSync(join(remote, 'hooks/pre-receive'));
	rmSync(join(blog, '.cms/cms-backup.db'));
	mkdirSync(join(blog, '.cms/cms-backup.db'));
	writeFileSync(join(blog, '.cms/cms-backup.db/unrelated.txt'), 'This is not the allowed backup file.');
	git('add', '-A', '.cms/cms-backup.db');
	git('commit', '-qm', 'replace backup file with a directory');
	const directoryRetry = await publish();
	assert.equal(directoryRetry.status, 500);
	assert.match(directoryRetry.data.message, /Unrelated commits/);
	git('reset', '--hard', backupTip);
	writeFileSync(join(blog, 'reverted.txt'), 'An unrelated change later reverted.');
	git('add', 'reverted.txt');
	git('commit', '-qm', 'temporary unrelated change');
	rmSync(join(blog, 'reverted.txt'));
	git('add', '-A', 'reverted.txt');
	git('commit', '-qm', 'revert unrelated file');
	const revertedRetry = await publish();
	assert.equal(revertedRetry.status, 500, 'history validation rejects unrelated changes even after they are reverted');
	assert.match(revertedRetry.data.message, /Unrelated commits/);
	assert.equal(git('rev-parse', 'origin/main'), remoteBeforeRetry);
	git('reset', '--hard', backupTip);
	writeFileSync(join(blog, 'manual.txt'), 'Unrelated local change.');
	git('add', 'manual.txt');
	git('commit', '-qm', 'cms: db backup');
	const unrelatedTip = git('rev-parse', 'HEAD');
	await assert.rejects(runBackup(), /publish push is pending/);
	assert.equal(git('rev-parse', 'HEAD'), unrelatedTip, 'backup rejects unrelated descendants before committing');
	const unrelatedRetry = await publish();
	assert.equal(unrelatedRetry.status, 500);
	assert.match(unrelatedRetry.data.message, /Unrelated commits/);
	assert.equal(git('rev-parse', 'origin/main'), remoteBeforeRetry, 'retry does not push unrelated commits');
	const nextStage = await createPost(fm('Next stage'), 'A new approval cannot authorize the unrelated commit.', 'cms');
	setStaged(nextStage.path, true);
	const unrelatedWithStage = await publish();
	assert.equal(unrelatedWithStage.status, 500);
	assert.match(unrelatedWithStage.data.message, /Unrelated commits/);
	assert.ok(!existsSync(join(blog, 'src/posts/next-stage.svx')));
	assert.equal(git('rev-parse', 'HEAD'), unrelatedTip);
	setStaged(nextStage.path, false);
	git('reset', '--hard', backupTip);
	git('reset', '--hard', beforeFailure);
	const rewoundRetry = await publish();
	assert.equal(rewoundRetry.status, 500);
	assert.match(rewoundRetry.data.message, /no longer contains the pending publish/);
	assert.equal(git('rev-parse', 'origin/main'), remoteBeforeRetry);
	git('reset', '--hard', backupTip);
	const retried = await publish();
	assert.equal(retried.status, 200, JSON.stringify(retried.data));
	assert.equal(retried.data.stagedCount, 0, 'retry pushes the committed snapshot without needing a new stage');
	assert.deepEqual(retried.data.results, [], 'retry does not rebuild');
	assert.equal(retried.status, 200, 'a legacy history beyond 100 backup commits recovers after the remote heals');
	assert.equal(git('show', `${committedBeforeRetry}:src/posts/stale.svx`).includes('Unapproved edit.'), true);
	assert.equal(git('rev-parse', 'HEAD'), git('rev-parse', 'origin/main'));
	assert.equal(hasPendingPublishPush(), false);

	const backupRecovery = await createPost(fm('Backup recovery'), 'Backup recovery body.', 'cms');
	setStaged(backupRecovery.path, true);
	writeFileSync(join(remote, 'hooks/pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
	assert.equal((await publish()).status, 502);
	const recoveryCommit = git('rev-parse', 'HEAD');
	rmSync(join(remote, 'hooks/pre-receive'));
	await assert.rejects(runBackup(), /publish push is pending/);
	const deferred = await createPost(fm('Deferred'), 'These staged edits wait for the pending push.', 'cms');
	setStaged(deferred.path, true);
	const baselineBeforeRetry = getMetaValue('importedSvxBaseline')!;
	setMetaValue('importedSvxBaseline', '');
	const retryBeforeInitialization = await runContender('publish', join(root, 'cms.db'));
	assert.equal(retryBeforeInitialization.status, 200, JSON.stringify(retryBeforeInitialization));
	assert.deepEqual(retryBeforeInitialization.data.results, []);
	assert.equal(retryBeforeInitialization.data.stagedCount, 0);
	assert.equal(getMetaValue('importedSvxBaseline'), '', 'retry runs before checkout initialization');
	setMetaValue('importedSvxBaseline', baselineBeforeRetry);
	assert.ok(getStagedPaths().has(deferred.path), 'new staging survives the push-only retry');
	assert.ok(!getPublishedPosts()[deferred.path]);
	setStaged(deferred.path, false);
	assert.equal(hasPendingPublishPush(), false, 'the pending publish is retried before backups resume');
	assert.equal(git('rev-parse', 'HEAD'), git('rev-parse', 'origin/main'));
	const alreadyPushedTip = git('rev-parse', 'HEAD');
	writeFileSync(join(blog, 'manual.txt'), 'Do not push this change during reconciliation.');
	git('add', 'manual.txt');
	git('commit', '-qm', 'unpublished manual change');
	const localOnlyTip = git('rev-parse', 'HEAD');
	setPendingPublishPush(recoveryCommit);
	const reconciled = await publish();
	assert.equal(reconciled.status, 200, JSON.stringify(reconciled.data));
	assert.match(reconciled.data.push.output, /already on origin\/main/);
	assert.deepEqual(reconciled.data.results, [], 'already-pushed reconciliation does not rebuild');
	assert.equal(git('rev-parse', 'HEAD'), localOnlyTip, 'reconciliation does not create a backup commit');
	assert.equal(git('rev-parse', 'origin/main'), alreadyPushedTip, 'reconciliation does not push unrelated local commits');
	assert.equal(hasPendingPublishPush(), false);
	git('reset', '--hard', alreadyPushedTip);

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
	const purgeVictim = await createPost(fm('Purge victim'), 'Stored draft.', 'cms');
	writeFileSync(join(blog, 'content/purge-victim.md'), 'Tracked boundary file.');
	git('add', 'content/purge-victim.md');
	git('commit', '-qm', 'track purge fixture');
	assert.equal(await purgePost(purgeVictim.path), true);
	assert.ok(!(await listPosts()).some((post) => post.path === purgeVictim.path));
	assert.ok(!existsSync(join(blog, 'content/purge-victim.md')));
	assert.equal(git('log', '-1', '--format=%s'), 'cms: delete purge-victim.md', 'purge commits its deletion while owning the write lock');
	assert.equal(git('status', '--porcelain'), '?? build.release\n?? build.started');
	console.log('publish.check: ok');
} finally {
	delete process.env.CMS_CHECK_BUILD_MODE;
	rmSync(root, { recursive: true, force: true });
}
