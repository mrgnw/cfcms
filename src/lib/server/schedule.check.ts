import assert from 'node:assert/strict';
import { execFileSync, fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = mkdtempSync(join(tmpdir(), 'cms-schedule-check-'));
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

const schedule = await import('../../routes/api/publish/schedule/+server.ts');
const { createPost, getPost, savePost } = await import('./content.ts');
const {
	claimPending, failMissedPending, getLatestSchedule, getSchedule, insertSchedule, listActiveSchedules, setStaged
} = await import('./db.ts');
const { POST: publishNow } = await import('../../routes/api/publish/+server.ts');
const { describeScheduleDrift, missedGraceMs, runDueSchedule } = await import('./schedule.ts');
const { listPosts } = await import('./content.ts');

const fm = (title: string) => `title: ${title}\ndate: 2026-01-01\npublish: true`;
const minute = 60_000;
const call = async (method: 'POST' | 'PATCH' | 'DELETE', body: unknown) => {
	const request = new Request('http://cms.test/api/publish/schedule', { method, body: JSON.stringify(body) });
	const response = await schedule[method]({ request });
	return { status: response.status, data: await response.json() };
};
const publishCommits = () => git('log', '--format=%s', 'main').split('\n').filter((subject) => subject === 'cms: publish').length;

const tickInFreshProcess = async (now: Date) => {
	const child = fork(new URL('./fixtures/checkout-worker.ts', import.meta.url), ['schedule-tick', now.toISOString()], {
		env: process.env,
		execArgv: ['--disable-warning=ExperimentalWarning', '--import', new URL('../../../scripts/check-hooks.ts', import.meta.url).href],
		stdio: ['ignore', 'pipe', 'pipe', 'ipc']
	});
	const exited = once(child, 'exit');
	const [message] = await once(child, 'message', { signal: AbortSignal.timeout(20_000) });
	await exited;
	return (message as { schedule: ReturnType<typeof getSchedule> }).schedule;
};

try {
	const timeZone = 'Europe/Madrid';
	const now = () => new Date();

	const rejected = await call('POST', { dueAt: new Date(Date.now() + minute).toISOString(), timeZone });
	assert.equal(rejected.status, 409, 'nothing staged cannot be scheduled');
	assert.equal((await call('POST', { dueAt: new Date(Date.now() - minute).toISOString(), timeZone })).status, 409);
	assert.equal((await call('POST', { dueAt: new Date(Date.now() + minute).toISOString(), timeZone: 'Mars/Base' })).status, 409);

	const first = await createPost(fm('Scheduled'), 'Approved scheduled body.', 'cms');
	setStaged(first.path, true);
	const created = await call('POST', { dueAt: new Date(Date.now() + minute).toISOString(), timeZone });
	assert.equal(created.status, 200, JSON.stringify(created.data));
	const scheduled = created.data.schedule;
	assert.equal(scheduled.state, 'pending');
	assert.equal(scheduled.timeZone, timeZone);
	assert.deepEqual(scheduled.pins.map((pin: { path: string; hash: string }) => [pin.path, pin.hash]), [[first.path, first.contentHash]]);
	assert.equal((await call('POST', { dueAt: new Date(Date.now() + 2 * minute).toISOString(), timeZone })).status, 409, 'one active schedule');

	assert.equal(await runDueSchedule(now()), null, 'not due yet');
	assert.equal(publishCommits(), 0);

	const due = new Date(Date.parse(scheduled.dueAt) + 1_000);
	const ran = await tickInFreshProcess(due);
	assert.equal(ran?.state, 'published', JSON.stringify(ran));
	assert.equal(ran?.pushed, true);
	execFileSync('git', ['-C', remote, 'merge-base', '--is-ancestor', ran?.commit ?? 'missing', 'main']);
	assert.equal(publishCommits(), 1);
	assert.equal(listActiveSchedules().length, 0, 'schedule cleared');
	assert.equal(await runDueSchedule(new Date(due.getTime() + minute)), null, 'published once');
	assert.equal(publishCommits(), 1);

	const pinned = await createPost(fm('Pinned'), 'Approved pinned body.', 'cms');
	setStaged(pinned.path, true);
	const second = (await call('POST', { dueAt: new Date(Date.now() + minute).toISOString(), timeZone })).data.schedule;
	const moved = await call('PATCH', { id: second.id, dueAt: new Date(Date.now() + 5 * minute).toISOString(), timeZone: 'UTC' });
	assert.equal(moved.data.schedule.timeZone, 'UTC');
	assert.equal(Date.parse(moved.data.schedule.dueAt) > Date.parse(second.dueAt), true);
	const edited = await savePost(pinned.path, pinned.frontmatter, 'Unapproved newer edit.', pinned.contentHash, 'cms');
	setStaged(pinned.path, true);
	assert.match(describeScheduleDrift(getLatestSchedule(), await listPosts()) ?? '', /restaged with different text/);
	const refused = await runDueSchedule(new Date(Date.parse(moved.data.schedule.dueAt) + 1_000));
	assert.equal(refused?.state, 'failed');
	assert.match(refused?.error ?? '', /staged batch changed since scheduling.*nothing was published/);
	assert.equal(publishCommits(), 1, 'restaged newer text is not published by the old schedule');
	assert.equal((await getPost(pinned.path)).contentHash, edited.post.contentHash, 'newer edit preserved');

	const third = (await call('POST', { dueAt: new Date(Date.now() + minute).toISOString(), timeZone })).data.schedule;
	const staleRead = getSchedule(third.id)!;
	await call('PATCH', { id: third.id, dueAt: new Date(Date.now() + 10 * minute).toISOString(), timeZone });
	const lateTick = new Date(Date.now() + 2 * minute).toISOString();
	assert.equal(claimPending(third.id, staleRead.dueAt, lateTick), false, 'a tick that read the old time cannot claim after a reschedule');
	assert.equal(failMissedPending(third.id, staleRead.dueAt, 'stale'), false, 'nor mark it missed');
	assert.equal(getSchedule(third.id)?.state, 'pending');
	assert.equal((await call('DELETE', { id: third.id })).data.schedule.state, 'cancelled');
	assert.equal(getLatestSchedule()?.state, 'cancelled', 'a cancel hides older outcomes');
	assert.equal(await runDueSchedule(new Date(Date.now() + 2 * minute)), null, 'cancelled schedule does not run');
	assert.equal((await call('DELETE', { id: third.id })).status, 409);
	assert.equal((await call('PATCH', { id: third.id, dueAt: new Date(Date.now() + minute).toISOString(), timeZone })).status, 409);

	process.env.CMS_CHECK_BUILD_MODE = 'fail';
	const failing = (await call('POST', { dueAt: new Date(Date.now() + minute).toISOString(), timeZone })).data.schedule;
	const failed = await runDueSchedule(new Date(Date.parse(failing.dueAt) + 1_000));
	delete process.env.CMS_CHECK_BUILD_MODE;
	assert.equal(failed?.state, 'failed');
	assert.match(failed?.error ?? '', /^Build failed; nothing was published/);
	assert.equal(getLatestSchedule()?.id, failing.id, 'failed schedule stays visible');
	assert.equal(publishCommits(), 1);

	const missed = (await call('POST', { dueAt: new Date(Date.now() + minute).toISOString(), timeZone })).data.schedule;
	const late = await runDueSchedule(new Date(Date.parse(missed.dueAt) + missedGraceMs + minute));
	assert.equal(late?.state, 'failed');
	assert.match(late?.error ?? '', /^Missed/);
	assert.equal(publishCommits(), 1, 'missed schedule is not published late');

	const crashedId = insertSchedule(new Date(Date.now() - minute).toISOString(), timeZone, [{ path: pinned.path, hash: edited.post.contentHash, title: 'Pinned' }]);
	assert.ok(crashedId);
	assert.ok(claimPending(crashedId, getSchedule(crashedId)!.dueAt, new Date().toISOString()));
	await runDueSchedule(now());
	assert.equal(getSchedule(crashedId)?.state, 'failed');
	assert.match(getSchedule(crashedId)?.error ?? '', /^Interrupted/);
	assert.equal(publishCommits(), 1, 'an interrupted run is never retried automatically');

	const recovered = (await call('POST', { dueAt: new Date(Date.now() + minute).toISOString(), timeZone })).data.schedule;
	const finished = await runDueSchedule(new Date(Date.parse(recovered.dueAt) + 1_000));
	assert.equal(finished?.state, 'published', JSON.stringify(finished));
	assert.equal(publishCommits(), 2);

	const contested = await createPost(fm('Contested'), 'Staged while another instance publishes.', 'cms');
	setStaged(contested.path, true);
	const holder = fork(new URL('./fixtures/checkout-worker.ts', import.meta.url), ['write'], {
		env: process.env,
		execArgv: ['--disable-warning=ExperimentalWarning', '--import', new URL('../../../scripts/check-hooks.ts', import.meta.url).href],
		stdio: ['ignore', 'pipe', 'pipe', 'ipc']
	});
	const holderExited = once(holder, 'exit');
	assert.equal((await once(holder, 'message', { signal: AbortSignal.timeout(10_000) }))[0], 'locked');
	const blocked = await call('POST', { dueAt: new Date(Date.now() + minute).toISOString(), timeZone });
	holder.send('release');
	await holderExited;
	assert.equal(blocked.status, 409, 'scheduling refuses while another instance holds the checkout');
	assert.match(blocked.data.message, /busy/);
	assert.equal(listActiveSchedules().length, 0, 'no schedule row from a contested read');
	assert.equal((await publishNow()).status, 200);
	assert.equal((await call('POST', { dueAt: new Date(Date.now() + minute).toISOString(), timeZone })).status, 409, 'nothing left to pin');
	assert.equal(publishCommits(), 3);

	const direct = await createPost(fm('Direct'), 'Published by a direct API call.', 'cms');
	setStaged(direct.path, true);
	const superseded = (await call('POST', { dueAt: new Date(Date.now() + minute).toISOString(), timeZone })).data.schedule;
	assert.equal((await publishNow()).status, 200, 'a manual publish without the UI');
	assert.equal(getSchedule(superseded.id)?.state, 'cancelled', 'the server cancels the schedule it superseded');
	assert.equal(await runDueSchedule(new Date(Date.parse(superseded.dueAt) + 1_000)), null);
	assert.equal(publishCommits(), 4);
} finally {
	rmSync(root, { recursive: true, force: true });
}
