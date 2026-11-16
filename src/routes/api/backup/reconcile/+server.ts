import { getBackupStatus, reconcileBackup, replacePendingBackup, retryPendingBackup } from '#lib/server/backup.js';
import { CheckoutBusyError } from '#lib/server/checkout-lock.js';
import type { RequestHandler } from './$types';

const commitPattern = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

export const GET: RequestHandler = () => Response.json(getBackupStatus(), { headers: { 'Cache-Control': 'no-store' } });

export const POST: RequestHandler = async ({ url, request }) => {
	const commit = url.searchParams.get('commit') ?? '';
	const replacement = url.searchParams.get('replace');
	const retry = url.searchParams.get('retry');
	if (retry !== null && (retry !== '1' || replacement !== null)) {
		return Response.json({ ok: false, message: 'Choose one backup recovery action' }, { status: 400 });
	}
	if (!commitPattern.test(commit) || replacement !== null && !commitPattern.test(replacement)) {
		return Response.json({ ok: false, message: 'The saved backup and remote commits are required' }, { status: 400 });
	}
	if (request.headers.get('origin') && request.headers.get('origin') !== url.origin) {
		return Response.json({ ok: false, message: 'Recovery must be requested from the CMS origin' }, { status: 403 });
	}
	try {
		const report = retry ? await retryPendingBackup(commit)
			: replacement === null ? await reconcileBackup(commit) : await replacePendingBackup(commit, replacement);
		return Response.json(report, { status: report.ok ? 200 : 409 });
	} catch (caught) {
		return Response.json({ ok: false, message: caught instanceof Error ? caught.message : 'Backup recovery failed' },
			{ status: caught instanceof CheckoutBusyError ? 409 : 502 });
	}
};
