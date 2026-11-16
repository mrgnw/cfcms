import { building } from '$app/env';
import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { startScheduler } from '#lib/server/schedule.js';

export const init: ServerInit = () => {
	if (!building) startScheduler();
};

export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	const headers = new Headers(response.headers);

	headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
	headers.set('Pragma', 'no-cache');
	headers.set('Expires', '0');

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
};
