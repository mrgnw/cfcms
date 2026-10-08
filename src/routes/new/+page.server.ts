export { actions } from '#lib/server/actions.js';

export const load = () => ({ date: new Date().toISOString().slice(0, 10) });
