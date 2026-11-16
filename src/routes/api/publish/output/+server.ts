import { CheckoutBusyError } from '#lib/server/checkout-lock.js';
import { approveRecoveredOutput } from '#lib/server/publish-protection.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, url }) => {
	if (request.headers.get('origin') && request.headers.get('origin') !== url.origin) {
		return Response.json({ ok: false, message: 'Output approval must be requested from the CMS origin' }, { status: 403 });
	}
	if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) {
		return Response.json({ ok: false, message: 'Submit the reviewed protected-output form' }, { status: 400 });
	}
	const form = await request.formData();
	const token = form.get('token');
	const remote = form.get('remote');
	if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)
		|| typeof remote !== 'string' || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(remote)
		|| form.get('confirm') !== 'reviewed-protected-output') {
		return Response.json({ ok: false, message: 'Review the exact protected-path patch and explicitly confirm replacing those remote paths' }, { status: 400 });
	}
	try {
		return Response.json(await approveRecoveredOutput(token, remote), { headers: { 'Cache-Control': 'no-store' } });
	} catch (caught) {
		return Response.json({ ok: false, message: caught instanceof Error ? caught.message : 'Output approval failed' },
			{ status: caught instanceof CheckoutBusyError ? 409 : 502, headers: { 'Cache-Control': 'no-store' } });
	}
};
