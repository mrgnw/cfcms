import { error, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { getPathById } from '$lib/server/db';

// 307, not 308: the id is permanent but the slug it points at can change
export const load = async ({ params, parent }) => {
	const path = getPathById(params.id);
	const post = path ? (await parent()).posts.find((item) => item.path === path) : undefined;
	if (!post) throw error(404, `No post with id ${params.id}`);
	throw redirect(307, resolve('/posts/[slug]', { slug: post.slug }));
};
