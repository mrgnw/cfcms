import { CheckoutBusyError } from '#lib/server/checkout-lock.js';
import { getPublicationRecovery, readPendingPublicationPatch, reconcilePublication } from '#lib/server/publish-recovery.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const patch = url.searchParams.get('patch');
	if (!patch) return Response.json(getPublicationRecovery(), { headers: { 'Cache-Control': 'no-store' } });
	try {
		return new Response(await readPendingPublicationPatch(patch), {
			headers: { 'Content-Type': 'text/x-patch; charset=utf-8', 'Content-Disposition': 'attachment; filename="pending-publication.patch"', 'Cache-Control': 'no-store' }
		});
	} catch (caught) {
		return Response.json({ ok: false, message: caught instanceof Error ? caught.message : 'Patch export failed' },
			{ status: caught instanceof CheckoutBusyError ? 409 : 422 });
	}
};

export const POST: RequestHandler = async ({ url, request }) => {
	const expected = url.searchParams.get('commit') ?? '';
	if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(expected)) {
		return Response.json({ ok: false, message: 'The pending publication commit is required' }, { status: 400 });
	}
	if (request.headers.get('origin') && request.headers.get('origin') !== url.origin) {
		return Response.json({ ok: false, message: 'Recovery must be requested from the CMS origin' }, { status: 403 });
	}
	try {
		const report = await reconcilePublication(expected);
		return Response.json(report, { status: report.ok ? 200 : 409 });
	} catch (caught) {
		return Response.json({ ok: false, message: caught instanceof Error ? caught.message : 'Recovery verification failed' },
			{ status: caught instanceof CheckoutBusyError ? 409 : 502 });
	}
};
