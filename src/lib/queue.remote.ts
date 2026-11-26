import { error } from '@sveltejs/kit';
import { command, query, requested } from '$app/server';
import * as v from 'valibot';
import { getPost, savePost } from '#lib/server/content.js';
import { addToEditing, getEditingOrder, removeFromEditing, reorderEditing } from '#lib/server/db.js';
import { setDeleteFlag } from '#lib/frontmatter.js';

const postPath = v.pipe(v.string(), v.nonEmpty());
const queuePaths = v.pipe(v.array(postPath), v.maxLength(500));

export const getQueue = query(async () => [...getEditingOrder().keys()]);

const refreshed = () => requested(getQueue, 1).refreshAll();

export const queueAdd = command(postPath, async (path) => {
	if (!await getPost(path).catch(() => null)) error(400, `Unknown post: ${path}`);
	addToEditing(path);
	await refreshed();
});

export const queueRemove = command(postPath, async (path) => {
	removeFromEditing(path);
	await refreshed();
});

export const queueReorder = command(queuePaths, async (paths) => {
	try {
		reorderEditing(paths);
	} catch (caught) {
		error(400, caught instanceof Error ? caught.message : 'Reorder failed');
	}
	await refreshed();
});

export const trash = command(postPath, async (path) => {
	const post = await getPost(path);
	const result = await savePost(path, setDeleteFlag(post.frontmatter, true), post.body, post.contentHash, 'cms');
	if (result.outcome === 'conflict') error(409, 'Post changed while trashing — retry');
	removeFromEditing(path);
	await refreshed();
});
