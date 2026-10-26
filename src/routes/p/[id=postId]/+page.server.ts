import { error, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { getPathById } from '#lib/server/db.js';

// post pages shallow-goto /p/<id>, so their relative ?/ actions post here
export { actions } from '#lib/server/actions.js';

// 307, not 308: the id is permanent but the slug it points at can change
// 303 after a form post, so the browser follows with GET instead of re-posting
export const load = async ({ params, parent, request }) => {
	const path = getPathById(params.id);
	const post = path ? (await parent()).posts.find((item) => item.path === path) : undefined;
	if (!post) throw error(404, `No post with id ${params.id}`);
	throw redirect(request.method === 'POST' ? 303 : 307, resolve('/[[stage=stage]]/posts/[slug]', { slug: post.slug }));
};
