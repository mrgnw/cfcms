import { BLOG_CONTENT_BASE_DIR } from '$app/env/private';
import { resolve } from 'node:path';

export const contentBaseDirectory = BLOG_CONTENT_BASE_DIR ?? resolve(process.cwd(), '..', '..');
export const contentDirectory = resolve(contentBaseDirectory, 'content');
export const svxDirectory = resolve(contentBaseDirectory, 'src/posts');
