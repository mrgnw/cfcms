import { createHash } from 'node:crypto';
import { getLastPublishedAt, getPublishedPosts, recordPublished, type PublishedPostState } from './db';
import type { DeployStatus } from '$lib/types';

export type { DeployStatus };

export type DeployedPostState = PublishedPostState;

export type DeployState = {
	lastPublishedAt: string | null;
	posts: Record<string, DeployedPostState>;
};

type PublishedPost = {
	path: string;
	title: string;
	slug: string;
	publish: boolean;
	deleteRequested: boolean;
	contentHash: string;
};

export const hashPostContent = (frontmatter: string, body: string) =>
	createHash('sha256')
		.update(`${frontmatter.trim()}\n---\n${body.replace(/\s+$/, '')}`)
		.digest('hex');

export const readDeployState = async (): Promise<DeployState> => ({
	lastPublishedAt: getLastPublishedAt(),
	posts: getPublishedPosts()
});

export const getDeployStatus = (
	post: { publish: boolean; deleteRequested: boolean; contentHash: string },
	deployed?: DeployedPostState
): DeployStatus => {
	if (post.deleteRequested) return deployed ? 'delete' : 'deleted';
	if (post.publish) {
		if (!deployed) return 'ready';
		return deployed.hash === post.contentHash ? 'live' : 'changed';
	}
	return deployed ? 'unpublish' : 'draft';
};

export const recordPublishedState = async (posts: PublishedPost[], commit: string | null) => {
	const lastPublishedAt = recordPublished(
		posts.filter((post) => post.publish && !post.deleteRequested),
		commit
	);

	return { lastPublishedAt };
};
