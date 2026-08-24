import { json } from '@sveltejs/kit';
import { listPosts, postsRev } from '$lib/server/content';

export const GET = async () => json({ rev: postsRev(await listPosts()) });
