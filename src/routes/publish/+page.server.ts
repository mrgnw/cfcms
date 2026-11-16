import { listPosts } from '#lib/server/content.js';
import { getPendingChanges } from '#lib/server/pending.js';
import { hasPendingPublishPush } from '#lib/server/publish.js';

export { actions } from '#lib/server/actions.js';

export const load = async () => ({
	pendingChanges: await getPendingChanges(await listPosts()),
	pendingPush: hasPendingPublishPush()
});
