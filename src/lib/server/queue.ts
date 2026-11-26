import { canonicalPostPath, getPost, savePost, UnknownPostError } from '#lib/server/content.js';
import { addToEditing, removeFromEditing, reorderEditing } from '#lib/server/db.js';
import { setDeleteFlag } from '#lib/frontmatter.js';

export const maxPostPathLength = 300;
export const maxQueueLength = 500;

export class QueueInputError extends Error {
	status: 400 | 409;

	constructor(status: 400 | 409, message: string) {
		super(message);
		this.status = status;
	}
}

const checkedPath = (path: string) => {
	if (!path) throw new QueueInputError(400, 'Post path is required');
	if (path.length > maxPostPathLength) throw new QueueInputError(400, 'Post path is too long');
	let canonical: string;
	try {
		canonical = canonicalPostPath(path);
	} catch (caught) {
		throw new QueueInputError(400, caught instanceof Error ? caught.message : 'Invalid post path');
	}
	if (canonical !== path) throw new QueueInputError(400, `Post path must be ${canonical}`);
	return path;
};

const existingPost = async (path: string) => {
	try {
		return await getPost(checkedPath(path));
	} catch (caught) {
		if (caught instanceof UnknownPostError) throw new QueueInputError(400, caught.message);
		throw caught;
	}
};

export const queueAdd = async (path: string) => {
	await existingPost(path);
	addToEditing(path);
};

export const queueRemove = (path: string) => removeFromEditing(checkedPath(path));

export const queueReorder = (paths: string[]) => {
	if (paths.length > maxQueueLength) throw new QueueInputError(400, 'Editing queue reorder exceeds sane bounds');
	for (const path of paths) checkedPath(path);
	try {
		reorderEditing(paths);
	} catch (caught) {
		throw new QueueInputError(400, caught instanceof Error ? caught.message : 'Reorder failed');
	}
};

export const trashPost = async (path: string) => {
	const post = await existingPost(path);
	const result = await savePost(path, setDeleteFlag(post.frontmatter, true), post.body, post.contentHash, 'cms');
	if (result.outcome === 'conflict') throw new QueueInputError(409, 'Post changed while trashing — retry');
	removeFromEditing(path);
};
