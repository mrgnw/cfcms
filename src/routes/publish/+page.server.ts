import { listPosts } from '#lib/server/content.js';
import { getPendingChanges } from '#lib/server/pending.js';
import { getPublicationRecovery } from '#lib/server/publish-recovery.js';
import { getBackupStatus } from '#lib/server/backup.js';

export { actions } from '#lib/server/actions.js';

export const load = async () => ({
	pendingChanges: await getPendingChanges(await listPosts()),
	pendingPush: Boolean(getPublicationRecovery().pendingCommit),
	publicationRecovery: getPublicationRecovery(),
	backupStatus: getBackupStatus()
});
