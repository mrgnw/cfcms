import { fail, redirect } from '@sveltejs/kit';
import {
	createPost,
	createUserVersion,
	deletePostFile,
	getLlmDraft,
	getPost,
	listPosts,
	postsRev,
	savePost
} from '$lib/server/content';
import {
	addToEditing,
	claimWriter,
	deleteVersion,
	getLastPublishedAt,
	listVersions,
	removeFromEditing,
	reorderEditing,
	upsertVersion
} from '$lib/server/db';
import { commitPost, diffNumstat } from '$lib/server/git';
import { runPublish } from '$lib/server/publish';
import { setDeleteFlag } from '$lib/frontmatter';
import { isValidWriter } from '$lib/save-rules';
import { isPending, statusOf } from '$lib/types';

const getPendingChanges = async (posts: Awaited<ReturnType<typeof listPosts>>) => {
	const pending = posts.filter((post) => isPending(statusOf(post)));

	return Promise.all(
		pending.map(async (post) => {
			const diff = post.baselineCommit ? await diffNumstat(post.baselineCommit, post.path) : null;

			return {
				path: post.path,
				title: post.title,
				date: post.date,
				status: statusOf(post),
				words: post.body.split(/\s+/).filter(Boolean).length,
				added: diff?.added ?? null,
				deleted: diff?.deleted ?? null
			};
		})
	);
};

export const load = async ({ url }) => {
	const posts = await listPosts();
	const selectedPath = url.searchParams.get('post') ?? '';
	const view = url.searchParams.get('view');
	const post = selectedPath ? await getPost(selectedPath).catch(() => null) : null;
	const llmDraft = post ? await getLlmDraft(post.path) : null;

	return {
		posts: posts.map(({ frontmatter, body, ...summary }) => summary),
		postsRev: postsRev(posts),
		post,
		llmDraft,
		versions: post ? listVersions(post.path).map(({ writer, body, updatedAt }) => ({ writer, body, updatedAt })) : null,
		view: view === 'publish' || view === 'deleted' ? view : null,
		pendingChanges: view === 'publish' ? await getPendingChanges(posts) : null,
		lastPublishedAt: getLastPublishedAt()
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
		const baseHash = String(form.get('baseHash') ?? '');
		const writer = String(form.get('writer') ?? '');
		const sessionId = String(form.get('sessionId') ?? '');

		if (!postPath) return fail(400, { message: 'Post path is required' });
		if (!baseHash) return fail(400, { message: 'baseHash is required' });
		if (!isValidWriter(writer)) {
			return fail(400, { message: `Invalid writer label: ${writer}` });
		}
		if (!/^[a-z0-9]{4,16}$/.test(sessionId)) {
			return fail(400, { message: 'Invalid session id' });
		}

		const grantedWriter = claimWriter(writer, sessionId);
		const result = await savePost(postPath, frontmatter, body, baseHash);

		if (result.outcome === 'conflict') {
			const storedWriter = upsertVersion({
				path: postPath,
				writer: grantedWriter,
				sessionId,
				baseHash,
				frontmatter,
				body
			});
			return {
				conflict: true,
				writer: storedWriter,
				currentHash: result.post.contentHash,
				currentFrontmatter: result.post.frontmatter,
				currentBody: result.post.body,
				savedPath: postPath
			};
		}

		const commit = result.outcome === 'write' ? await commitPost(postPath, 'save') : null;

		return {
			message: !commit
				? 'Already saved'
				: commit.ok
					? commit.committed
						? 'Saved and committed'
						: 'Saved; no git changes'
					: 'Saved; git backup failed',
			savedPath: postPath,
			savedHash: result.post.contentHash,
			backup: commit,
			writer: grantedWriter
		};
	},
	dismissVersion: async ({ request }) => {
		const form = await request.formData();
		const path = String(form.get('path') ?? '');
		const writer = String(form.get('writer') ?? '');

		if (!path || !writer) return fail(400, { message: 'path and writer are required' });

		deleteVersion(path, writer);
		return { dismissed: writer };
	},
	fork: async ({ request }) => {
		const form = await request.formData();
		const llmPath = String(form.get('path') ?? '');

		if (!llmPath.endsWith('.llm.md')) return fail(400, { message: 'Not an .llm.md draft' });

		const userPath = await createUserVersion(llmPath);
		await commitPost(userPath, 'create');

		throw redirect(303, `/?post=${encodeURIComponent(userPath)}`);
	},
	publish: async () => {
		try {
			return { publish: await runPublish() };
		} catch (caught) {
			return fail(500, { message: caught instanceof Error ? caught.message : 'Publish failed' });
		}
	},
	queueAdd: async ({ request }) => {
		const form = await request.formData();
		const path = String(form.get('path') ?? '');

		if (!path) return fail(400, { message: 'Post path is required' });

		const post = await getPost(path).catch(() => null);
		if (!post) return fail(400, { message: `Unknown post: ${path}` });

		addToEditing(path);
		return { queued: path };
	},
	queueRemove: async ({ request }) => {
		const form = await request.formData();
		const path = String(form.get('path') ?? '');

		if (!path) return fail(400, { message: 'Post path is required' });

		removeFromEditing(path);
		return { unqueued: path };
	},
	queueReorder: async ({ request }) => {
		const form = await request.formData();
		const raw = String(form.get('paths') ?? '[]');
		let paths: unknown;

		try {
			paths = JSON.parse(raw);
		} catch {
			return fail(400, { message: 'paths must be valid JSON' });
		}

		if (!Array.isArray(paths) || paths.some((path) => typeof path !== 'string')) {
			return fail(400, { message: 'paths must be a JSON array of strings' });
		}

		try {
			reorderEditing(paths as string[]);
		} catch (caught) {
			return fail(400, { message: caught instanceof Error ? caught.message : 'Reorder failed' });
		}
		return { reordered: paths.length };
	},
	trash: async ({ request }) => {
		const form = await request.formData();
		const path = String(form.get('path') ?? '');

		if (!path) return fail(400, { message: 'Post path is required' });

		const post = await getPost(path);

		const result = await savePost(path, setDeleteFlag(post.frontmatter, true), post.body, post.contentHash);
		if (result.outcome === 'conflict') return fail(409, { message: 'Post changed while trashing — retry' });

		await commitPost(path, 'save');
		removeFromEditing(path);
		return { trashed: path };
	},
	restore: async ({ request }) => {
		const form = await request.formData();
		const path = String(form.get('path') ?? '');

		if (!path) return fail(400, { message: 'Post path is required' });

		const post = await getPost(path);

		const result = await savePost(path, setDeleteFlag(post.frontmatter, false), post.body, post.contentHash);
		if (result.outcome === 'conflict') return fail(409, { message: 'Post changed while restoring — retry' });

		await commitPost(path, 'save');
		return { restored: path };
	},
	purge: async ({ request }) => {
		const form = await request.formData();
		const path = String(form.get('path') ?? '');

		if (!path) return fail(400, { message: 'Post path is required' });

		await deletePostFile(path);
		await commitPost(path, 'delete');
		return { purged: path };
	}
};
