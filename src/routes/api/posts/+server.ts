import { maybeDailyBackup } from '#lib/server/backup.js';
import { listPosts, postsRev } from '#lib/server/content.js';

export const GET = async () => {
	maybeDailyBackup();
	return Response.json({ rev: postsRev(await listPosts()) });
};
