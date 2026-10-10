import { error } from '@sveltejs/kit';
import { appendFile, stat } from 'node:fs/promises';
import { lagBatchMaxBytes, lagLogMaxBytes, parseLagBatch } from '#lib/lag.js';
import { lagLogPath } from '#lib/server/paths.js';

export const POST = async ({ request }) => {
	if (Number(request.headers.get('content-length') ?? 0) > lagBatchMaxBytes) throw error(413, 'Lag batch too large');
	const batch = parseLagBatch(await request.text());
	if (!batch) throw error(400, 'Invalid lag batch');

	// ponytail: the log stops growing at the cap; delete the file to start a fresh capture
	const size = (await stat(lagLogPath).catch(() => null))?.size ?? 0;
	if (size > lagLogMaxBytes) return new Response(null, { status: 507 });

	await appendFile(lagLogPath, `${JSON.stringify({ receivedAt: new Date().toISOString(), ...batch })}\n`);
	return new Response(null, { status: 204 });
};
