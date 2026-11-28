import { query } from '$app/server';
import { listPostsFromStore, postsRev } from '#lib/server/content.js';

// A store read: the content directory scan runs from the layout load and the /api/posts poll, never from here.
export const getPosts = query(async () => {
	const posts = await listPostsFromStore();
	return { posts: posts.map(({ frontmatter, body, ...summary }) => summary), rev: postsRev(posts) };
});
