import type { DeployStatus } from '#lib/types.js';

export const getDeployStatus = (
	post: { publish: boolean; deleteRequested: boolean; contentHash: string },
	deployed?: { hash: string }
): DeployStatus => {
	if (post.deleteRequested) return deployed ? 'delete' : 'deleted';
	if (post.publish) {
		if (!deployed) return 'ready';
		return deployed.hash === post.contentHash ? 'live' : 'changed';
	}
	return deployed ? 'unpublish' : 'draft';
};
