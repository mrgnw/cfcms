export const splitBlocks = (markdown: string): string[] => {
	const blocks: string[] = [];
	let current: string[] = [];
	let fenceMarker = '';

	const flush = () => {
		const text = current.join('\n').replace(/^\n+|\n+$/g, '');
		if (text.trim()) blocks.push(text);
		current = [];
	};

	for (const line of markdown.split('\n')) {
		const fence = line.match(/^(`{3,}|~{3,})/)?.[1] ?? '';

		if (fenceMarker) {
			current.push(line);
			if (fence.startsWith(fenceMarker)) {
				fenceMarker = '';
				flush();
			}
			continue;
		}

		if (fence) {
			flush();
			fenceMarker = fence;
			current.push(line);
			continue;
		}

		if (!line.trim()) {
			flush();
			continue;
		}

		current.push(line);
	}

	flush();
	return blocks;
};

export const normalizeBlock = (block: string) => block.replace(/\s+/g, ' ').trim();

export const isProse = (block: string) =>
	!/^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|`{3,}|~{3,}|\|)/.test(block);

export const splitSentences = (block: string): string[] => {
	if (!isProse(block)) return [block];
	const flat = block.replace(/\s*\n\s*/g, ' ').trim();
	const parts = flat.split(/(?<=[.!?])\s+(?=["'“(]?[A-Z0-9])/);
	return parts.map((s) => s.trim()).filter(Boolean);
};

export const insertBlock = (userBody: string, llmBlocks: string[], index: number): string => {
	if (index < 0 || index >= llmBlocks.length) throw new Error(`Block index ${index} out of range`);

	const target = llmBlocks[index];
	const userBlocks = splitBlocks(userBody);
	const userNorms = userBlocks.map(normalizeBlock);
	const matchOf = (i: number) => userNorms.indexOf(normalizeBlock(llmBlocks[i]));

	let insertAt = -1;

	for (let i = index - 1; i >= 0 && insertAt < 0; i--) {
		const match = matchOf(i);
		if (match >= 0) insertAt = match + 1;
	}

	for (let i = index + 1; i < llmBlocks.length && insertAt < 0; i++) {
		const match = matchOf(i);
		if (match >= 0) insertAt = match;
	}

	if (insertAt < 0) insertAt = userBlocks.length;

	userBlocks.splice(insertAt, 0, target);
	return userBlocks.join('\n\n');
};
