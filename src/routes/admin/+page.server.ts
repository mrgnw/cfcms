import { listLlmDrafts } from '#lib/server/content.js';

export { actions } from '#lib/server/actions.js';

export const load = async () => ({ llmDrafts: await listLlmDrafts() });
