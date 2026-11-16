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
	if (request.headers.get('origin') && request.headers.get('origin') !== url.origin) {
		return Response.json({ ok: false, message: 'Recovery must be requested from the CMS origin' }, { status: 403 });
	}
	const args = new URLSearchParams(url.search);
	if (request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) {
		const form = await request.formData();
		for (const name of ['commit', 'delivered', 'remote', 'confirm']) {
			const value = form.get(name);
			if (typeof value === 'string') args.set(name, value);
		}
	}
	const expected = args.get('commit') ?? '';
	const delivery = args.get('delivered');
	const remote = args.get('remote') ?? '';
	if (delivery !== null && (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(delivery)
		|| !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(remote)
		|| args.get('confirm') !== 'reviewed-history-and-current-remote')) {
		return Response.json({ ok: false, message: 'Review the historical delivery commit and current remote path comparison, then confirm both' }, { status: 400 });
	}
	if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(expected)) {
		return Response.json({ ok: false, message: 'The pending publication commit is required' }, { status: 400 });
	}
	try {
		const report = await reconcilePublication(expected, delivery === null ? undefined : { commit: delivery, remote, confirmed: true });
		return Response.json(report, { status: report.ok ? 200 : 409 });
	} catch (caught) {
		return Response.json({ ok: false, message: caught instanceof Error ? caught.message : 'Recovery verification failed' },
			{ status: caught instanceof CheckoutBusyError ? 409 : 502 });
	}
};
