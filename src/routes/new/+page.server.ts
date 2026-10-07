export { actions } from '$lib/server/actions';

export const load = () => ({ date: new Date().toISOString().slice(0, 10) });
