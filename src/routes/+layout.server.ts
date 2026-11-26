import { listPosts, postsRev } from '#lib/server/content.js';
import { getLastPublishedAt } from '#lib/server/db.js';
import { postsDependency } from '#lib/types.js';

export const load = async ({ cookies, depends }) => {
	depends(postsDependency);
	const posts = await listPosts();

	return {
		posts: posts.map(({ frontmatter, body, ...summary }) => summary),
		postsRev: postsRev(posts),
		lastPublishedAt: getLastPublishedAt(),
		sidebarOpen: cookies.get('sidebar') !== 'closed'
	};
};
