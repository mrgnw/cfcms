export type SaveDecision = 'write' | 'noop' | 'conflict';

export const decideSave = (baseHash: string, currentHash: string, incomingHash: string): SaveDecision => {
	if (baseHash === currentHash) return 'write';
	if (incomingHash === currentHash) return 'noop';
	return 'conflict';
};

export const normalizeNewlines = (text: string) => text.replaceAll('\r\n', '\n');

export const reservedWriters = new Set(['llm', 'ext']);

export const isValidWriter = (writer: string) => /^[a-z][a-z0-9]{0,7}$/.test(writer) && !reservedWriters.has(writer);

export const storedBodyForm = (frontmatter: string, body: string): string => {
	const normalized = body.replace(/\s+$/, '');
	return frontmatter.trim() ? `\n${normalized}\n` : normalized;
};
