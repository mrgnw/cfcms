export type SaveDecision = 'write' | 'noop' | 'conflict';

export const decideSave = (baseHash: string, currentHash: string, incomingHash: string): SaveDecision => {
	if (baseHash === currentHash) return 'write';
	if (incomingHash === currentHash) return 'noop';
	return 'conflict';
};

export const storedBodyForm = (frontmatter: string, body: string): string => {
	const normalized = body.replace(/\s+$/, '');
	return frontmatter.trim() ? `\n${normalized}\n` : normalized;
};
