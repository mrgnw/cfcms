import { listPosts } from '#lib/server/content.js';
import { getLatestSchedule } from '#lib/server/db.js';
import { getPendingChanges } from '#lib/server/pending.js';
import { getPublicationRecovery } from '#lib/server/publish-recovery.js';
import { getBackupStatus } from '#lib/server/backup.js';
import { describeScheduleDrift } from '#lib/server/schedule.js';

export { actions } from '#lib/server/actions.js';

export const load = async () => {
	const posts = await listPosts();
	const schedule = getLatestSchedule();
	return {
		pendingChanges: await getPendingChanges(posts),
		pendingPush: Boolean(getPublicationRecovery().pendingCommit),
		publicationRecovery: getPublicationRecovery(),
		backupStatus: getBackupStatus(),
		schedule,
		scheduleDrift: describeScheduleDrift(schedule, posts)
	};
};
