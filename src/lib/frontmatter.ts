export type StandardFields = {
	title: string;
	date: string;
	tags: string[];
	publish: boolean;
	pin: boolean;
};

export type ParsedFrontmatter = StandardFields & {
	custom: string;
};

const STANDARD_KEYS = new Set(['title', 'date', 'tags', 'publish', 'pin', 'pinned']);

const stripQuotes = (value: string) => value.replace(/^['"]|['"]$/g, '');

const parseTags = (raw: string): string[] => {
	const value = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw;
	return value
		.split(',')
		.map((t) => stripQuotes(t.trim()))
		.filter(Boolean);
};

export const parseFrontmatter = (raw: string): ParsedFrontmatter => {
	const lines = raw.split(/\r?\n/);
	const fields: Partial<StandardFields> = {};
	const customLines: string[] = [];

	for (const line of lines) {
		const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
		if (!match) {
			if (line.trim()) customLines.push(line);
			continue;
		}
		const [, key, rawValue] = match;
		const value = rawValue.trim();

		if (!STANDARD_KEYS.has(key)) {
			customLines.push(line);
			continue;
		}

		if (key === 'title') fields.title = stripQuotes(value);
		else if (key === 'date') fields.date = stripQuotes(value);
		else if (key === 'tags') fields.tags = parseTags(value);
		else if (key === 'publish') fields.publish = value === 'true';
		else if (key === 'pin' || key === 'pinned') fields.pin = value === 'true';
	}

	return {
		title: fields.title ?? '',
		date: fields.date ?? '',
		tags: fields.tags ?? [],
		publish: fields.publish ?? false,
		pin: fields.pin ?? false,
		custom: customLines.join('\n')
	};
};

const yamlQuote = (value: string) => {
	if (value === '') return "''";
	if (/^[A-Za-z0-9 _.\-/]+$/.test(value)) return value;
	return `'${value.replaceAll("'", "''")}'`;
};

const yamlTags = (tags: string[]) => {
	if (!tags.length) return '[]';
	return `[${tags.map(yamlQuote).join(', ')}]`;
};

export const serializeFrontmatter = (fields: ParsedFrontmatter): string => {
	const lines = [
		`title: ${yamlQuote(fields.title)}`,
		`date: ${fields.date || '1970-01-01'}`,
		`tags: ${yamlTags(fields.tags)}`,
		`publish: ${fields.publish ? 'true' : 'false'}`
	];
	if (fields.pin) lines.push('pin: true');
	const custom = fields.custom.trim();
	if (custom) lines.push(custom);
	return lines.join('\n');
};
