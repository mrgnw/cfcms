import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalBody, hashPostContent, splitRawPost } from '$lib/post-text';
import { normalizeNewlines } from '$lib/save-rules';
import {
	appendRevision,
	deleteVersion,
	getPublishedPosts,
	getRevisionByHash,
	getStoredPost,
	listVersions,
	updatePublishedHash,
	upsertVersion
} from './db';
import { svxDirectory } from './paths';

export type FastForward = 'head' | 'site' | 'conflict';

// ponytail: body only; frontmatter edits made on the site are not detected
export const fastForwardLive = (path: string, baseBody: string): FastForward => {
	const live = listVersions(path).find((version) => version.writer === 'live');
	const head = getStoredPost(path);
	if (!live || !head) throw new Error(`fastForwardLive: ${path} has no live version or no head`);

	if (head.body === baseBody) {
		const hash = hashPostContent(head.frontmatter, live.body);
		appendRevision(path, head.frontmatter, live.body, hash, 'live');
		updatePublishedHash(path, hash);
		deleteVersion(path, 'live');
		return 'site';
	}
	if (live.body === baseBody) {
		deleteVersion(path, 'live');
		return 'head';
	}
	return 'conflict';
};

const readSiteBody = async (slug: string) => {
	const raw = await readFile(resolve(svxDirectory, `${slug}.svx`), 'utf8').catch(() => null);
	// ponytail: a post deleted on the site is not detected
	return raw === null ? null : canonicalBody(splitRawPost(normalizeNewlines(raw)).body);
};

export const syncSiteText = async () => {
	for (const [path, published] of Object.entries(getPublishedPosts())) {
		if (!published.slug) continue;
		const publishedRevision = getRevisionByHash(path, published.hash);
		const head = getStoredPost(path);
		if (!publishedRevision || !head) continue;

		const siteBody = await readSiteBody(published.slug);
		if (siteBody === null || siteBody === publishedRevision.body) continue;

		upsertVersion({
			path,
			writer: 'live',
			sessionId: 'svx',
			baseHash: published.hash,
			frontmatter: head.frontmatter,
			body: siteBody
		});
		fastForwardLive(path, publishedRevision.body);
	}
};
