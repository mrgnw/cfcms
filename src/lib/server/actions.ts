import { fail, redirect, type Actions } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { createPost, createUserVersion, getPost, importAllLlmDrafts, purgePost, savePost } from '$lib/server/content';
import {
	addToEditing,
	claimWriter,
	deleteVersion,
	listVersions,
	removeFromEditing,
	reorderEditing,
	setStaged,
	upsertVersion
} from '$lib/server/db';
import { commitPost } from '$lib/server/git';
import { hasSiteVersion, shipsHeadText } from '$lib/server/pending';
import { setDeleteFlag } from '$lib/frontmatter';
import { isValidWriter, normalizeNewlines } from '$lib/save-rules';
import { statusOf } from '$lib/types';

export const actions = {
	create: async ({ request }) => {
		const form = await request.formData();
		const title = String(form.get('title') ?? '').trim();

		if (!title) return fail(400, { message: 'Title is required' });

		const post = await createPost(title);

		throw redirect(303, resolve('/posts/[slug]', { slug: post.slug }));
	},
	save: async ({ request }) => {
		const form = await request.formData();
		const postPath = String(form.get('path') ?? '');
		const frontmatter = normalizeNewlines(String(form.get('frontmatter') ?? ''));
		const body = normalizeNewlines(String(form.get('body') ?? ''));
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
		const result = await savePost(postPath, frontmatter, body, baseHash, grantedWriter);

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

		return {
			message: result.outcome === 'write' ? 'Saved' : 'Already saved',
			savedPath: postPath,
			savedHash: result.post.contentHash,
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

		const { path: userPath } = await createUserVersion(llmPath);

		throw redirect(303, resolve('/posts/[slug]', { slug: (await getPost(userPath)).slug }));
	},
	importLlm: async () => ({ importedLlm: await importAllLlmDrafts() }),
	stage: async ({ request }) => {
		const form = await request.formData();
		const path = String(form.get('path') ?? '');

		if (!path) return fail(400, { message: 'Post path is required' });
		if (path.endsWith('.llm.md')) return fail(400, { message: 'Fork the llm draft before staging it' });
		const post = await getPost(path).catch(() => null);
		if (!post) return fail(400, { message: `Unknown post: ${path}` });
		if (shipsHeadText(statusOf(post)) && hasSiteVersion(path)) {
			return fail(409, { message: 'Resolve the site version before staging' });
		}

		setStaged(path, true);
		return { staged: path };
	},
	resolveSite: async ({ request }) => {
		const form = await request.formData();
		const path = String(form.get('path') ?? '');
		const choice = String(form.get('choice') ?? '');

		if (!path) return fail(400, { message: 'Post path is required' });
		if (choice !== 'mine' && choice !== 'theirs') return fail(400, { message: 'choice must be mine or theirs' });

		const site = listVersions(path).find((version) => version.writer === 'site');
		if (!site) return fail(404, { message: 'No site version to resolve' });

		if (choice === 'theirs') {
			const post = await getPost(path);
			const result = await savePost(path, site.frontmatter, site.body, post.contentHash, 'cms');
			if (result.outcome === 'conflict') return fail(409, { message: 'Post changed while resolving — retry' });
		}

		deleteVersion(path, 'site');
		return { resolved: path };
	},
	unstage: async ({ request }) => {
		const form = await request.formData();
		const path = String(form.get('path') ?? '');

		if (!path) return fail(400, { message: 'Post path is required' });

		setStaged(path, false);
		return { unstaged: path };
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

		const result = await savePost(path, setDeleteFlag(post.frontmatter, true), post.body, post.contentHash, 'cms');
		if (result.outcome === 'conflict') return fail(409, { message: 'Post changed while trashing — retry' });

		removeFromEditing(path);
		return { trashed: path };
	},
	restore: async ({ request }) => {
		const form = await request.formData();
		const path = String(form.get('path') ?? '');

		if (!path) return fail(400, { message: 'Post path is required' });

		const post = await getPost(path);

		const result = await savePost(path, setDeleteFlag(post.frontmatter, false), post.body, post.contentHash, 'cms');
		if (result.outcome === 'conflict') return fail(409, { message: 'Post changed while restoring — retry' });

		return { restored: path };
	},
	purge: async ({ request }) => {
		const form = await request.formData();
		const path = String(form.get('path') ?? '');

		if (!path) return fail(400, { message: 'Post path is required' });

		const hadFile = await purgePost(path);
		if (hadFile) await commitPost(path, 'delete');
		return { purged: path };
	}
} satisfies Actions;
