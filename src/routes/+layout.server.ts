import { listPosts } from '#lib/server/content.js';
import { getLastPublishedAt } from '#lib/server/db.js';

// The scan runs here on a full load and in the /api/posts poll; getPosts() only reads what it ingested.
export const load = async ({ cookies }) => {
	await listPosts();
	return {
		lastPublishedAt: getLastPublishedAt(),
		sidebarOpen: cookies.get('sidebar') !== 'closed'
	};
};
