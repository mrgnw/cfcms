import { error } from '@sveltejs/kit';
import { getPost } from '#lib/server/content.js';
import { listVersions } from '#lib/server/db.js';

export const GET = async ({ url }) => {
	const path = url.searchParams.get('path') ?? '';

	if (!path) throw error(400, 'path is required');

	const post = await getPost(path).catch(() => null);

	if (!post) throw error(404, `Unknown post: ${path}`);

	return Response.json({
		contentHash: post.contentHash,
		frontmatter: post.frontmatter,
		body: post.body,
		id: post.id ?? null,
		url: post.id ? `${url.origin}/p/${post.id}` : null,
		title: post.title,
		slug: post.slug,
		deployStatus: post.deployStatus,
		versions: listVersions(post.path).map(({ writer, frontmatter, body, updatedAt }) => ({
			writer,
			frontmatter,
			body,
			updatedAt
		}))
	});
};
