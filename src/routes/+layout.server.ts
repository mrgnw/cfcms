import { listPosts, postsRev } from '$lib/server/content';
import { getLastPublishedAt } from '$lib/server/db';

export const load = async () => {
	const posts = await listPosts();

	return {
		posts: posts.map(({ frontmatter, body, ...summary }) => summary),
		postsRev: postsRev(posts),
		lastPublishedAt: getLastPublishedAt()
	};
};
