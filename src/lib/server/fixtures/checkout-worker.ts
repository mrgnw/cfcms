import { once } from 'node:events';
import { withCheckoutLock } from '../checkout-lock.ts';

await withCheckoutLock(async () => {
	process.send?.('locked');
	await once(process, 'message');
});
process.disconnect?.();
