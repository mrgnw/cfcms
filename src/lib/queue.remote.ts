import { error } from '@sveltejs/kit';
import { command, query, requested } from '$app/server';
import * as v from 'valibot';
import { getEditingOrder } from '#lib/server/db.js';
import * as queue from '#lib/server/queue.js';

const postPath = v.pipe(v.string(), v.nonEmpty(), v.maxLength(queue.maxPostPathLength));
const queuePaths = v.pipe(v.array(postPath), v.maxLength(queue.maxQueueLength));

export const getQueue = query(async () => [...getEditingOrder().keys()]);

const refreshed = () => requested(getQueue, 1).refreshAll();

async function mutate(work: () => unknown) {
	try {
		await work();
	} catch (caught) {
		if (caught instanceof queue.QueueInputError) error(caught.status, caught.message);
		throw caught;
	}
	await refreshed();
}

export const queueAdd = command(postPath, (path) => mutate(() => queue.queueAdd(path)));
export const queueRemove = command(postPath, (path) => mutate(() => queue.queueRemove(path)));
export const queueReorder = command(queuePaths, (paths) => mutate(() => queue.queueReorder(paths)));
export const trash = command(postPath, (path) => mutate(() => queue.trashPost(path)));
