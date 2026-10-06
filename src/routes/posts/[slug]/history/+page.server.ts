import { error } from '@sveltejs/kit';
import { getPost } from '$lib/server/content';
import { getRevision, getStoredPost, listRevisions } from '$lib/server/db';
import { splitBlocks } from '$lib/blocks';
import { diffSegments, lineDiffCounts } from '$lib/segment-diff';
import { parseFrontmatter } from '$lib/frontmatter';

export { actions } from '$lib/server/actions';

export const load = async ({ params, parent, url }) => {
	const matches = (await parent()).posts.filter((item) => item.slug === params.slug);
	if (matches.length !== 1) throw error(404, `No single post with slug ${params.slug}`);

	const post = await getPost(matches[0].path);
	const revisions = listRevisions(post.path);
	if (revisions.length === 0) throw error(404, `No history for ${post.path}`);

	const requested = Number(url.searchParams.get('rev'));
	const index = Math.max(0, revisions.findIndex((entry) => entry.rev === requested));
	const entry = revisions[index];
	const revision = getRevision(post.path, entry.rev);
	if (!revision) throw error(404, `Revision ${entry.rev} is gone`);

	const previous = revisions[index + 1];
	const previousBody = previous ? (getRevision(post.path, previous.rev)?.body ?? null) : null;

	return {
		post: { path: post.path, slug: post.slug, title: post.title, contentHash: post.contentHash },
		publishedHash: getStoredPost(post.path)?.publishedHash ?? null,
		revisions,
		selected: {
			...entry,
			title: parseFrontmatter(revision.frontmatter).title,
			blocks: splitBlocks(revision.body),
			segments: previousBody === null ? null : diffSegments(previousBody, previousBody, revision.body),
			lines: previousBody === null ? null : lineDiffCounts(previousBody, revision.body)
		}
	};
};
