import { error } from '@sveltejs/kit';
import { getPost } from '#lib/server/content.js';

export const GET = async ({ url }) => {
	const path = url.searchParams.get('path') ?? '';

	if (!path) throw error(400, 'path is required');

	const post = await getPost(path).catch(() => null);

	if (!post) throw error(404, `Unknown post: ${path}`);

	return Response.json({ contentHash: post.contentHash, frontmatter: post.frontmatter, body: post.body });
};
