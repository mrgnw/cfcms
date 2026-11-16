import { fail, redirect, type Actions } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { createPost, getPost, importAllLlmDrafts, importLlmDraft, purgePost, savePost } from '#lib/server/content.js';
import {
	addToEditing,
	claimWriter,
	deleteVersion,
	getRevision,
	labelRevision,
	listVersions,
	removeFromEditing,
	reorderEditing,
	setStaged,
	setTriageField,
	upsertVersion
} from '#lib/server/db.js';
import { CheckoutBusyError } from '#lib/server/checkout-lock.js';
import { hasSiteVersion, shipsHeadText } from '#lib/server/pending.js';
import { isBlankDraft, setDeleteFlag } from '#lib/frontmatter.js';
import { isValidWriter, normalizeNewlines } from '#lib/save-rules.js';
import { isEffort, isTriageField, nextStepLimit, statusOf } from '#lib/types.js';

const maxRevisionLabel = 60;

export const actions = {
	create: async ({ request }) => {
		const form = await request.formData();
		const frontmatter = normalizeNewlines(String(form.get('frontmatter') ?? ''));
		const body = normalizeNewlines(String(form.get('body') ?? ''));
		const writer = String(form.get('writer') ?? '');
		const sessionId = String(form.get('sessionId') ?? '');

		if (isBlankDraft(frontmatter, body)) return fail(400, { message: 'Nothing to save yet' });
		if (!isValidWriter(writer)) return fail(400, { message: `Invalid writer label: ${writer}` });
		if (!/^[a-z0-9]{4,16}$/.test(sessionId)) return fail(400, { message: 'Invalid session id' });

		const post = await createPost(frontmatter, body, claimWriter(writer, sessionId));

		return { created: { path: post.path, slug: post.slug, id: post.id ?? null, contentHash: post.contentHash } };
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
	labelRevision: async ({ request }) => {
		const form = await request.formData();
		const path = String(form.get('path') ?? '');
		const rev = Number(form.get('rev'));
		const label = String(form.get('label') ?? '').trim();

		if (!path || !Number.isInteger(rev)) return fail(400, { message: 'path and rev are required' });
		if (label.length > maxRevisionLabel) return fail(400, { message: `Name must be ${maxRevisionLabel} characters or fewer` });
		if (!labelRevision(path, rev, label || null)) return fail(404, { message: `No revision ${rev} for ${path}` });
		return { labelled: rev };
	},
	restoreRevision: async ({ request }) => {
		const form = await request.formData();
		const path = String(form.get('path') ?? '');
		const rev = Number(form.get('rev'));

		if (!path || !Number.isInteger(rev)) return fail(400, { message: 'path and rev are required' });
		const revision = getRevision(path, rev);
		if (!revision) return fail(404, { message: `No revision ${rev} for ${path}` });

		const post = await getPost(path);
		const result = await savePost(path, revision.frontmatter, revision.body, post.contentHash, 'cms');
		if (result.outcome === 'conflict') return fail(409, { message: 'Post changed while restoring — retry' });

		throw redirect(303, resolve('/[[stage=stage]]/posts/[slug]', { slug: result.post.slug }));
	},
	importLlm: async () => ({ importedLlm: await importAllLlmDrafts() }),
	importLlmDraft: async ({ request }) => {
		const form = await request.formData();
		const llmPath = String(form.get('path') ?? '');

		if (!llmPath.endsWith('.llm.md')) return fail(400, { message: 'Not an .llm.md draft' });

		const { path, created } = await importLlmDraft(llmPath);
		return { imported: { path, created, slug: (await getPost(path)).slug } };
	},
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
	triage: async ({ request }) => {
		const form = await request.formData();
		const path = String(form.get('path') ?? '');
		const field = form.get('field');
		const base = form.get('base');
		const raw = String(form.get('value') ?? '');

		if (!path) return fail(400, { message: 'Post path is required' });
		if (!isTriageField(field)) return fail(400, { message: 'field must be nextStep or effort' });
		if (typeof base !== 'string') return fail(400, { message: 'base is required' });

		const value = (field === 'nextStep' ? raw.trim().replace(/\s+/g, ' ') : raw) || null;
		if (field === 'nextStep' && value && value.length > nextStepLimit) {
			return fail(400, { message: `Next step must be ${nextStepLimit} characters or fewer` });
		}
		if (field === 'effort' && value && !isEffort(value)) {
			return fail(400, { message: 'effort must be quick, deep or empty' });
		}

		const post = await getPost(path).catch(() => null);
		if (!post) return fail(400, { message: `Unknown post: ${path}` });

		const result = setTriageField(path, field, value, base || null);
		if (!result.saved) {
			return fail(409, { message: 'Changed in another session', field, current: result.current, rev: result.rev });
		}
		return { triaged: path, field, value: result.current, rev: result.rev };
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

		try {
			await purgePost(path);
		} catch (caught) {
			if (caught instanceof CheckoutBusyError) return fail(409, { message: caught.message });
			throw caught;
		}
		return { purged: path };
	}
} satisfies Actions;
