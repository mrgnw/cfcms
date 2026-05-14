import { fail, redirect } from '@sveltejs/kit';
import { createPost, getPost, listPosts, savePost } from '$lib/server/content';
import { commitPost } from '$lib/server/git';
import { runPublish } from '$lib/server/publish';

export const load = async ({ url }) => {
	const posts = await listPosts();
	const selectedPath = url.searchParams.get('post') ?? posts[0]?.path ?? '';
	const post = selectedPath ? await getPost(selectedPath) : null;

	return {
		posts,
		post
	};
};

export const actions = {
	create: async ({ request }) => {
		const form = await request.formData();
		const title = String(form.get('title') ?? '').trim();

		if (!title) return fail(400, { message: 'Title is required' });

		const post = await createPost(title);
		const commit = await commitPost(post.path, 'create');

		if (!commit.ok) return fail(500, { message: commit.output || 'Git commit failed' });

		throw redirect(303, `/?post=${encodeURIComponent(post.path)}`);
	},
	save: async ({ request }) => {
		const form = await request.formData();
		const postPath = String(form.get('path') ?? '');
		const frontmatter = String(form.get('frontmatter') ?? '');
		const body = String(form.get('body') ?? '');

		if (!postPath) return fail(400, { message: 'Post path is required' });

		await savePost(postPath, frontmatter, body);
		const commit = await commitPost(postPath, 'save');

		if (!commit.ok) return fail(500, { message: commit.output || 'Git commit failed' });

		return { message: commit.committed ? 'Saved and committed' : 'Saved; no git changes', savedPath: postPath };
	},
	publish: async () => {
		try {
			return { publish: await runPublish() };
		} catch (caught) {
			return fail(500, { message: caught instanceof Error ? caught.message : 'Publish failed' });
		}
	}
};
