import { listPosts } from '$lib/server/content';
import { getPublishedPosts, getRevisionByHash, getStagedPaths, listVersions } from '$lib/server/db';
import { syncSiteText } from '$lib/server/site-text';
import { diffSegments, lineDiffCounts } from '$lib/segment-diff';
import { isPending, statusOf } from '$lib/types';

export const shipsHeadText = (status: ReturnType<typeof statusOf>) => status === 'ready' || status === 'changed';

export const hasSiteVersion = (path: string) => listVersions(path).some((version) => version.writer === 'site');

export const getPendingChanges = async (posts: Awaited<ReturnType<typeof listPosts>>) => {
	// llm drafts are a writing tool; they never publish, so they never pend
	await syncSiteText();
	const pending = posts.filter((post) => isPending(statusOf(post)) && !post.path.endsWith('.llm.md'));
	const published = getPublishedPosts();
	const staged = getStagedPaths();

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
			staged: staged.has(post.path),
			blocked: shipsHeadText(statusOf(post)) && hasSiteVersion(post.path),
			words: post.body.split(/\s+/).filter(Boolean).length,
			added: diff?.added ?? null,
			deleted: diff?.deleted ?? null,
			segments: diffSegments(publishedRevision?.body ?? '', publishedRevision?.body ?? '', after)
		};
	});
};
