import { cancelSchedule, createSchedule, rescheduleSchedule, ScheduleRequestError } from '#lib/server/schedule.js';
import { getLatestSchedule } from '#lib/server/db.js';

const respond = async (operation: () => unknown) => {
	try {
		return Response.json({ ok: true, schedule: await operation() });
	} catch (caught) {
		if (!(caught instanceof ScheduleRequestError)) throw caught;
		return Response.json({ ok: false, message: caught.message }, { status: 409 });
	}
};

const readBody = async (request: Request) => {
	const body = await request.json().catch(() => null);
	return body && typeof body === 'object' ? body as Record<string, unknown> : {};
};

const readId = (body: Record<string, unknown>) => {
	if (!Number.isSafeInteger(body.id)) throw new ScheduleRequestError('id is required');
	return body.id as number;
};

export const GET = () => Response.json({ schedule: getLatestSchedule() });

export const POST = async ({ request }: { request: Request }) => {
	const body = await readBody(request);
	return respond(() => createSchedule(body.dueAt, body.timeZone));
};

export const PATCH = async ({ request }: { request: Request }) => {
	const body = await readBody(request);
	return respond(() => rescheduleSchedule(readId(body), body.dueAt, body.timeZone));
};

export const DELETE = async ({ request }: { request: Request }) => {
	const body = await readBody(request);
	return respond(() => cancelSchedule(readId(body)));
};
