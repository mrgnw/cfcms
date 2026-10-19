import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';

export { actions } from '#lib/server/actions.js';

// ponytail: bookmarks from the ?post= / ?view= era; drop once nobody has them
export const load = async ({ url, parent }) => {
	const view = url.searchParams.get('view');
	if (view === 'publish') throw redirect(308, resolve('publish'));
	if (view === 'deleted') throw redirect(308, resolve('deleted'));

	const path = url.searchParams.get('post');
	if (!path) return {};

	const post = (await parent()).posts.find((item) => item.path === path);
	if (post) throw redirect(308, resolve('/[[stage=stage]]/posts/[slug]', { slug: post.slug }));
	return {};
};
