import { listPosts, listPostsFromStore } from '#lib/server/content.js';
import { getPublishedPosts, getRevisionByHash, getStagedRevisions, listVersions } from '#lib/server/db.js';
import { CheckoutBusyError, withCheckoutReadLock } from '#lib/server/checkout-lock.js';
import { syncSiteTextLocked } from '#lib/server/site-text.js';
import { diffSegments, lineDiffCounts } from '#lib/segment-diff.js';
import { isPending, statusOf } from '#lib/types.js';

export const shipsHeadText = (status: ReturnType<typeof statusOf>) => status === 'ready' || status === 'changed';

export const hasSiteVersion = (path: string) => listVersions(path).some((version) => version.writer === 'site');

export const getPendingChanges = async (posts: Awaited<ReturnType<typeof listPosts>>) => {
	// llm drafts are a writing tool; they never publish, so they never pend
	try {
		posts = await withCheckoutReadLock(async () => {
			await syncSiteTextLocked();
			return listPostsFromStore();
		});
	} catch (caught) {
		if (!(caught instanceof CheckoutBusyError)) throw caught;
	}
	const pending = posts.filter((post) => isPending(statusOf(post)) && !post.path.endsWith('.llm.md'));
	const published = getPublishedPosts();
	const staged = getStagedRevisions();

	return pending.map((post) => {
		const publishedRevision = published[post.path]
			? getRevisionByHash(post.path, published[post.path].hash)
			: null;
		const diff = publishedRevision ? lineDiffCounts(publishedRevision.body, post.body) : null;
		const after = shipsHeadText(statusOf(post)) ? post.body : '';

		return {
			path: post.path,
			slug: post.slug,
			title: post.title,
			date: post.date,
			status: statusOf(post),
			staged: staged.get(post.path) === post.contentHash,
			editedAfterStaging: staged.has(post.path) && staged.get(post.path) !== post.contentHash,
			blocked: shipsHeadText(statusOf(post)) && hasSiteVersion(post.path),
			words: post.body.split(/\s+/).filter(Boolean).length,
			added: diff?.added ?? null,
			deleted: diff?.deleted ?? null,
			segments: diffSegments(publishedRevision?.body ?? '', publishedRevision?.body ?? '', after)
		};
	});
};
