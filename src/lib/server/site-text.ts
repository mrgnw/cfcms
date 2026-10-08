import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalBody, hashPostContent, splitRawPost } from '#lib/post-text.js';
import { normalizeNewlines } from '#lib/save-rules.js';
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
export const fastForwardSite = (path: string, baseBody: string): FastForward => {
	const site = listVersions(path).find((version) => version.writer === 'site');
	const head = getStoredPost(path);
	if (!site || !head) throw new Error(`fastForwardSite: ${path} has no site version or no head`);

	if (head.body === baseBody) {
		const hash = hashPostContent(head.frontmatter, site.body);
		appendRevision(path, head.frontmatter, site.body, hash, 'site');
		updatePublishedHash(path, hash);
		deleteVersion(path, 'site');
		return 'site';
	}
	if (site.body === baseBody) {
		deleteVersion(path, 'site');
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
			writer: 'site',
			sessionId: 'svx',
			baseHash: published.hash,
			frontmatter: head.frontmatter,
			body: siteBody
		});
		fastForwardSite(path, publishedRevision.body);
	}
};
