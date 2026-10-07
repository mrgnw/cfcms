import { listLlmDrafts } from '$lib/server/content';

export { actions } from '$lib/server/actions';

export const load = async () => ({ llmDrafts: await listLlmDrafts() });
