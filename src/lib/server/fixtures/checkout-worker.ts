import { once } from 'node:events';
import { CheckoutBusyError, withCheckoutLock, withCheckoutReadLock } from '../checkout-lock.ts';

const mode = process.argv[2];
if (mode === 'publish') {
	const { POST } = await import('../../../routes/api/publish/+server.ts');
	const response = await POST();
	process.send?.({ ok: response.ok, status: response.status, data: await response.json() });
} else if (mode === 'schedule-tick') {
	const { runDueSchedule } = await import('../schedule.ts');
	process.send?.({ schedule: await runDueSchedule(new Date(process.argv[3])) });
} else if (mode === 'purge' || mode === 'baseline' || mode === 'import') {
	try {
		if (mode === 'purge') {
			const { purgePost } = await import('../content.ts');
			await purgePost(process.argv[3]);
		} else if (mode === 'baseline') {
			const { ensureSvxBaseline } = await import('../import-svx.ts');
			await ensureSvxBaseline();
		} else {
			const { ensureCorpusImported } = await import('../import-corpus.ts');
			await ensureCorpusImported();
		}
		process.send?.({ ok: true });
	} catch (caught) {
		const { listStoredPosts } = await import('../db.ts');
		process.send?.({ ok: false, busy: caught instanceof CheckoutBusyError, posts: listStoredPosts().length });
	}
} else {
	await (mode === 'read' ? withCheckoutReadLock : withCheckoutLock)(async () => {
		process.send?.('locked');
		await once(process, 'message');
	});
}
process.disconnect?.();
