import { error, json } from '@sveltejs/kit';
import { runPublish } from '$lib/server/publish';

export const POST = async () => {
	try {
		const result = await runPublish();
		return json(result, { status: result.ok ? 200 : 502 });
	} catch (caught) {
		error(500, caught instanceof Error ? caught.message : 'Publish failed');
	}
};
