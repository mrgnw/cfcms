import { createHash } from 'node:crypto';
import { canonicalBody } from './post-body.ts';

export { canonicalBody, renderPost, splitRawPost } from './post-body.ts';

export const hashPostContent = (frontmatter: string, body: string) =>
	createHash('sha256')
		.update(`${frontmatter.trim()}\n---\n${canonicalBody(body)}`)
		.digest('hex');
