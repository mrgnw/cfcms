import { fail, redirect } from '@sveltejs/kit';
import { createPost, getLlmDraft, getPost, listPosts, savePost } from '$lib/server/content';
import { commitPost } from '$lib/server/git';
import { runPublish } from '$lib/server/publish';

export const load = async ({ url }) => {
	const posts = await listPosts();
	const selectedPath = url.searchParams.get('post') ?? posts[0]?.path ?? '';
	const post = selectedPath ? await getPost(selectedPath) : null;
	const llmDraft = post ? await getLlmDraft(post.path) : null;

	return {
		posts,
		post,
		llmDraft
	};
};

export const actions = {
	create: async ({ request }) => {
		const form = await request.formData();
		const title = String(form.get('title') ?? '').trim();

		if (!title) return fail(400, { message: 'Title is required' });

		const post = await createPost(title);
		await commitPost(post.path, 'create');

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

		return {
			message: commit.ok
				? commit.committed
					? 'Saved and committed'
					: 'Saved; no git changes'
				: 'Saved; git backup failed',
			savedPath: postPath,
			backup: commit
		};
	},
	publish: async () => {
		try {
			return { publish: await runPublish() };
		} catch (caught) {
			return fail(500, { message: caught instanceof Error ? caught.message : 'Publish failed' });
		}
	}
};
