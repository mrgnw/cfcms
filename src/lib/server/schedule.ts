import { isPending, statusOf, type PublishSchedule, type SchedulePin } from '#lib/types.js';
import { CheckoutBusyError, withCheckoutLock } from './checkout-lock';
import { initializeContentLocked, listPostsLocked, type Post } from './content';
import {
	cancelPending, claimPending, failMissedPending, finishSchedule, getSchedule, getStagedRevisions, insertSchedule,
	listActiveSchedules, reschedulePending
} from './db';
import { pinMismatch, publishLocked } from './publish';
import { getPendingPublishPush } from './publish-push';
import { getPublicationReconciliation } from './publish-protection';
import { databasePath } from './paths';
import { existsSync } from 'node:fs';

export const scheduleTickMs = 60_000;
// ponytail: fixed grace window; make it a setting if a writer needs late catch-up publishing.
export const missedGraceMs = 30 * 60_000;
const maxLeadMs = 366 * 24 * 60 * 60_000;
const outputLimit = 4_000;

export const interruptedMessage =
	'Interrupted: the CMS stopped while this publish was running, so its result was not recorded and it will not retry. ' +
	'Posts still staged were not published; if the Publish button offers "Retry publish push", the commit exists but was not pushed.';

export class ScheduleRequestError extends Error {}

export const stagedBatch = (posts: Post[], approvals: Map<string, string | null>): SchedulePin[] =>
	posts
		.filter((post) => isPending(statusOf(post)) && approvals.get(post.path) === post.contentHash)
		.map((post) => ({ path: post.path, hash: post.contentHash, title: post.title }));

export const editedAfterStaging = (posts: Post[], approvals: Map<string, string | null>) =>
	posts.filter((post) => approvals.has(post.path) && approvals.get(post.path) !== post.contentHash);

export const parseScheduleTime = (dueAt: unknown, timeZone: unknown, now: Date) => {
	if (typeof dueAt !== 'string' || typeof timeZone !== 'string' || timeZone.length > 64) {
		throw new ScheduleRequestError('dueAt and timeZone are required');
	}
	const due = new Date(dueAt);
	if (Number.isNaN(due.getTime())) throw new ScheduleRequestError('dueAt is not a valid time');
	if (due.getTime() <= now.getTime()) throw new ScheduleRequestError('Choose a time in the future');
	if (due.getTime() - now.getTime() > maxLeadMs) throw new ScheduleRequestError('Choose a time within a year');
	try {
		new Intl.DateTimeFormat('en', { timeZone });
	} catch {
		throw new ScheduleRequestError(`Unknown time zone: ${timeZone}`);
	}
	return { dueAt: due.toISOString(), timeZone };
};

// Pins are read and stored under the checkout write lock, so no publish can run between the read and the insert.
export const createSchedule = (dueAt: unknown, timeZone: unknown, now = new Date()) => withCheckoutLock(async () => {
	const time = parseScheduleTime(dueAt, timeZone, now);
	if (getPendingPublishPush()) throw new ScheduleRequestError('Retry the pending publish push before scheduling');
	if (getPublicationReconciliation()) throw new ScheduleRequestError('Finish the publish recovery review before scheduling');
	await initializeContentLocked();
	const posts = await listPostsLocked();
	const approvals = getStagedRevisions();
	const edited = editedAfterStaging(posts, approvals);
	if (edited.length) {
		throw new ScheduleRequestError(`Restage or unstage posts edited after staging: ${edited.map((post) => post.path).join(', ')}`);
	}
	const pins = stagedBatch(posts, approvals);
	if (!pins.length) throw new ScheduleRequestError('Stage changes before scheduling');
	const id = insertSchedule(time.dueAt, time.timeZone, pins);
	if (id === null) throw new ScheduleRequestError('A publish is already scheduled; reschedule or cancel it');
	return getSchedule(id);
});

export const rescheduleSchedule = (id: number, dueAt: unknown, timeZone: unknown, now = new Date()) => {
	const time = parseScheduleTime(dueAt, timeZone, now);
	if (!reschedulePending(id, time.dueAt, time.timeZone)) {
		throw new ScheduleRequestError('Only a pending scheduled publish can be rescheduled');
	}
	return getSchedule(id);
};

export const cancelSchedule = (id: number) => {
	if (!cancelPending(id)) throw new ScheduleRequestError('Only a pending scheduled publish can be cancelled');
	return getSchedule(id);
};

const isDue = (schedule: PublishSchedule, now: Date) =>
	schedule.state === 'running' || Date.parse(schedule.dueAt) <= now.getTime();

const tail = (output: string) => output.slice(-outputLimit);

const runClaimed = async (schedule: PublishSchedule) => {
	try {
		const result = await publishLocked(schedule.pins);
		if (result.ok) {
			finishSchedule(schedule.id, 'running', { state: 'published', commit: result.commit ?? null, pushed: true });
		} else if (result.commit) {
			finishSchedule(schedule.id, 'running', {
				state: 'failed',
				commit: result.commit,
				pushed: false,
				error: 'Committed but not pushed. Use "Retry publish push" when the remote is available.',
				output: tail(result.push.output)
			});
		} else {
			const failed = result.results.find((target) => !target.ok);
			finishSchedule(schedule.id, 'running', {
				state: 'failed',
				error: `${failed?.name === 'build' ? 'Build' : 'Publish'} failed; nothing was published. Fix it, then schedule again.`,
				output: tail(failed?.output ?? result.push.output)
			});
		}
	} catch (caught) {
		finishSchedule(schedule.id, 'running', {
			state: 'failed',
			error: caught instanceof Error ? caught.message : String(caught)
		});
	}
};

// Runs inside the checkout write lock, so a 'running' row here belongs to a process that died mid-publish.
const runDueLocked = async (now: Date) => {
	for (const stale of listActiveSchedules().filter((schedule) => schedule.state === 'running')) {
		finishSchedule(stale.id, 'running', { state: 'failed', error: interruptedMessage });
	}
	const due = listActiveSchedules().find((schedule) => isDue(schedule, now));
	if (!due) return null;
	if (now.getTime() - Date.parse(due.dueAt) > missedGraceMs) {
		const error = `Missed: the CMS was not running between ${due.dueAt} and ${now.toISOString()}. Nothing was published; schedule again or publish now.`;
		return failMissedPending(due.id, due.dueAt, error) ? getSchedule(due.id) : null;
	}
	if (!claimPending(due.id, due.dueAt, now.toISOString())) return null;
	await runClaimed(due);
	return getSchedule(due.id);
};

let ticking = false;

export const runDueSchedule = async (now = new Date()) => {
	// A missing store has no schedules; opening it here would create it before any request asks for one.
	if (ticking || !existsSync(databasePath) || !listActiveSchedules().some((schedule) => isDue(schedule, now))) return null;
	ticking = true;
	try {
		return await withCheckoutLock(() => runDueLocked(now));
	} catch (caught) {
		if (caught instanceof CheckoutBusyError) return null;
		throw caught;
	} finally {
		ticking = false;
	}
};

let timer: ReturnType<typeof setInterval> | null = null;

export const startScheduler = () => {
	if (timer) return;
	const tick = () => runDueSchedule().catch((caught) => console.error('scheduled publish tick failed', caught));
	timer = setInterval(tick, scheduleTickMs);
	timer.unref();
	void tick();
};

export const describeScheduleDrift = (schedule: PublishSchedule | null, posts: Post[]) => {
	if (schedule?.state !== 'pending') return null;
	const approvals = getStagedRevisions();
	const edited = editedAfterStaging(posts, approvals).map((post) => post.path);
	return pinMismatch(schedule.pins, stagedBatch(posts, approvals), edited);
};
