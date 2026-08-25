import { fail, redirect } from '@sveltejs/kit';
import {
	createPost,
	createUserVersion,
	getPost,
	listPosts,
	postsRev,
	purgePost,
	savePost
} from '$lib/server/content';
import {
	addToEditing,
	claimWriter,
	deleteVersion,
	getLastPublishedAt,
	getPublishedPosts,
	getRevisionByHash,
	listVersions,
	removeFromEditing,
	reorderEditing,
	upsertVersion
} from '$lib/server/db';
import { commitPost } from '$lib/server/git';
import { runPublish } from '$lib/server/publish';
import { parseFrontmatter, setDeleteFlag } from '$lib/frontmatter';
import { diffSegments, lineDiffCounts } from '$lib/segment-diff';
import { isValidWriter, normalizeNewlines } from '$lib/save-rules';
import { isPending, statusOf } from '$lib/types';

const getPendingChanges = async (posts: Awaited<ReturnType<typeof listPosts>>) => {
	const pending = posts.filter((post) => isPending(statusOf(post)));
	const published = getPublishedPosts();

	return pending.map((post) => {
		const publishedRevision = published[post.path]
			? getRevisionByHash(post.path, published[post.path].hash)
			: null;
		const diff = publishedRevision ? lineDiffCounts(publishedRevision.body, post.body) : null;

		return {
			path: post.path,
			title: post.title,
			date: post.date,
			status: statusOf(post),
			words: post.body.split(/\s+/).filter(Boolean).length,
			added: diff?.added ?? null,
			deleted: diff?.deleted ?? null
		};
	});
};

const diffFields = (mainFrontmatter: string, versionFrontmatter: string) => {
	const yours = parseFrontmatter(mainFrontmatter);
	const theirs = parseFrontmatter(versionFrontmatter);
	const pairs: [string, string, string][] = [
		['title', yours.title, theirs.title],
		['date', yours.date, theirs.date],
		['tags', yours.tags.join(', '), theirs.tags.join(', ')],
		['custom', yours.custom, theirs.custom]
	];
	const fields = pairs.filter(([, a, b]) => a !== b).map(([name, a, b]) => ({ name, yours: a, theirs: b }));
	return fields.length ? fields : null;
};

const versionsFor = async (post: Awaited<ReturnType<typeof getPost>>) =>
	Promise.all(
		listVersions(post.path).map(async (version) => {
			const base = getRevisionByHash(post.path, version.baseHash);
			return {
				writer: version.writer,
				body: version.body,
				updatedAt: version.updatedAt,
				segments: base ? diffSegments(base.body, post.body, version.body) : null,
				fields: diffFields(post.frontmatter, version.frontmatter)
			};
		})
	);

export const load = async ({ url }) => {
	const posts = await listPosts();
	const selectedPath = url.searchParams.get('post') ?? '';
	const view = url.searchParams.get('view');
	const post = selectedPath ? await getPost(selectedPath).catch(() => null) : null;

	return {
		posts: posts.map(({ frontmatter, body, ...summary }) => summary),
		postsRev: postsRev(posts),
		post,
		versions: post ? await versionsFor(post) : null,
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

		throw redirect(303, `/?post=${encodeURIComponent(post.path)}`);
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

		const userPath = await createUserVersion(llmPath);

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
};
