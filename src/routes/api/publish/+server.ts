import { PublishConflictError, runPublish } from '#lib/server/publish.js';
import { CheckoutBusyError } from '#lib/server/checkout-lock.js';

export const POST = async () => {
	try {
		const result = await runPublish();
		if (!result.ok) console.error('publish failed', JSON.stringify(result));
		return Response.json(result, { status: result.ok ? 200 : 502 });
	} catch (caught) {
		return Response.json(
			{
				ok: false,
				message: caught instanceof Error ? caught.message : 'Publish failed',
				editedAfterStaging: caught instanceof PublishConflictError ? caught.editedAfterStaging : undefined
			},
			{ status: caught instanceof CheckoutBusyError || caught instanceof PublishConflictError ? 409 : 500 }
		);
	}
};
