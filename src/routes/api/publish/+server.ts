import { runPublish } from '#lib/server/publish.js';
import { CheckoutBusyError } from '#lib/server/checkout-lock.js';

export const POST = async () => {
	try {
		const result = await runPublish();
		if (!result.ok) console.error('publish failed', JSON.stringify(result));
		return Response.json(result, { status: result.ok ? 200 : 502 });
	} catch (caught) {
		return Response.json(
			{ ok: false, message: caught instanceof Error ? caught.message : 'Publish failed' },
			{ status: caught instanceof CheckoutBusyError ? 409 : 500 }
		);
	}
};
