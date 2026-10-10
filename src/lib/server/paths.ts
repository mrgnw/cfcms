import { BLOG_CMS_DB, BLOG_CONTENT_BASE_DIR } from '$app/env/private';
import { dirname, resolve } from 'node:path';

export const contentBaseDirectory = BLOG_CONTENT_BASE_DIR ?? resolve(process.cwd(), '..', '..');
export const contentDirectory = resolve(contentBaseDirectory, 'content');
export const svxDirectory = resolve(contentBaseDirectory, 'src/posts');

export const databasePath = resolve(BLOG_CMS_DB ?? resolve(process.cwd(), '.data/cms.db'));
export const lagLogPath = resolve(dirname(databasePath), 'lag.jsonl');
