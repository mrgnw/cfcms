import { json } from '@sveltejs/kit';
import { maybeDailyBackup } from '$lib/server/backup';
import { listPosts, postsRev } from '$lib/server/content';

export const GET = async () => {
	maybeDailyBackup();
	return json({ rev: postsRev(await listPosts()) });
};
