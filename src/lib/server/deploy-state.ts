import { getLastPublishedAt, getPublishedPosts, recordPublished, type PublishedPostState } from './db';

export { hashPostContent } from '#lib/post-text.js';

export type { DeployStatus } from '#lib/types.js';
export { getDeployStatus } from '#lib/deploy-status.js';

export type DeployedPostState = PublishedPostState;

export type DeployState = {
	lastPublishedAt: string | null;
	posts: Record<string, DeployedPostState>;
};

type PublishedPost = {
	path: string;
	title: string;
	slug: string;
	contentHash: string;
};

export const readDeployState = async (): Promise<DeployState> => ({
	lastPublishedAt: getLastPublishedAt(),
	posts: getPublishedPosts()
});

export const recordPublishedState = async (posts: PublishedPost[], commit: string | null) => {
	const lastPublishedAt = recordPublished(posts, commit);

	return { lastPublishedAt };
};
