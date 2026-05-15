import { env } from '$env/dynamic/private';
import { resolve } from 'node:path';

export const contentBaseDirectory = env.BLOG_CONTENT_BASE_DIR ?? resolve(process.cwd(), '..', '..');
export const contentDirectory = resolve(contentBaseDirectory, 'content');
