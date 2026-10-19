import { error, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { getPost, importLlmDraft } from '#lib/server/content.js';
import { getRevisionByHash, listVersions } from '#lib/server/db.js';
import { parseFrontmatter } from '#lib/frontmatter.js';
import { diffSegments } from '#lib/segment-diff.js';

export { actions } from '#lib/server/actions.js';

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

export const load = async ({ params, parent }) => {
	const matches = (await parent()).posts.filter((item) => item.slug === params.slug);
	if (matches.length === 0) throw error(404, `No post with slug ${params.slug}`);
	if (matches.length > 1) {
		throw error(409, `Slug ${params.slug} is used by ${matches.map((item) => item.path).join(', ')}`);
	}

	// opening a standalone .llm.md imports it: the post is born at its own path with the draft as its llm version
	if (matches[0].path.endsWith('.llm.md')) {
		const { path } = await importLlmDraft(matches[0].path);
		throw redirect(303, resolve('/[[stage=stage]]/posts/[slug]', { slug: (await getPost(path)).slug }));
	}

	const post = await getPost(matches[0].path);
	return { post, versions: await versionsFor(post) };
};
