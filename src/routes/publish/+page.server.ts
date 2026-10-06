import { listPosts } from '$lib/server/content';
import { getPendingChanges } from '$lib/server/pending';

export { actions } from '$lib/server/actions';

export const load = async () => ({ pendingChanges: await getPendingChanges(await listPosts()) });
