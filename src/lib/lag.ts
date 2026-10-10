// A keystroke slower than this, from input event to next paint, is recorded.
export const lagThresholdMs = 50;
export const lagBatchMaxEvents = 50;
export const lagBatchMaxBytes = 64 * 1024;
export const lagLogMaxBytes = 5 * 1024 * 1024;

export type LagBatch = {
	device: string;
	editor: string;
	path: string;
	inputs: number;
	slow: number;
	events: Record<string, unknown>[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

const isLabel = (value: unknown): value is string => typeof value === 'string' && value.length <= 200;

export const parseLagBatch = (text: string): LagBatch | null => {
	if (text.length > lagBatchMaxBytes) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return null;
	}
	if (!isRecord(parsed)) return null;
	const { device, editor, path, inputs, slow, events } = parsed;
	if (!isLabel(device) || !isLabel(editor) || !isLabel(path)) return null;
	if (!isCount(inputs) || !isCount(slow)) return null;
	if (!Array.isArray(events) || events.length > lagBatchMaxEvents || !events.every(isRecord)) return null;
	return { device, editor, path, inputs, slow, events };
};
