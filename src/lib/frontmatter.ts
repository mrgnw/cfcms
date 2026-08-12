export type StandardFields = {
	title: string;
	date: string;
	tags: string[];
	publish: boolean;
	pin: boolean;
	deleteRequested: boolean;
};

export type ParsedFrontmatter = StandardFields & {
	custom: string;
};

// 'edit' stays a standard key with no field: parse consumes it so saves drop the legacy flag
const STANDARD_KEYS = new Set(['title', 'date', 'tags', 'publish', 'pin', 'pinned', 'edit', 'delete', 'deleted']);

export const parseYamlScalar = (value: string) => {
	const trimmed = value.trim();
	const quote = trimmed.at(0);

	if ((quote === "'" || quote === '"') && trimmed.at(-1) === quote) {
		const inner = trimmed.slice(1, -1);

		if (quote === "'") return inner.replaceAll("''", "'");
		return inner.replaceAll('\\"', '"').replaceAll('\\\\', '\\');
	}

	return trimmed;
};

const parseTags = (raw: string): string[] => {
	const value = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw;
	return value
		.split(',')
		.map((t) => parseYamlScalar(t))
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

		if (key === 'title') fields.title = parseYamlScalar(value);
		else if (key === 'date') fields.date = parseYamlScalar(value);
		else if (key === 'tags') fields.tags = parseTags(value);
		else if (key === 'publish') fields.publish = value === 'true';
		else if (key === 'pin' || key === 'pinned') fields.pin = value === 'true';
		else if (key === 'delete' || key === 'deleted') fields.deleteRequested = value === 'true';
	}

	return {
		title: fields.title ?? '',
		date: fields.date ?? '',
		tags: fields.tags ?? [],
		publish: fields.publish ?? false,
		pin: fields.pin ?? false,
		deleteRequested: fields.deleteRequested ?? false,
		custom: customLines.join('\n')
	};
};

export const formatYamlScalar = (value: string) => {
	if (value === '') return "''";
	if (/^[A-Za-z0-9 _.\-/]+$/.test(value)) return value;
	return `'${value.replaceAll("'", "''")}'`;
};

const yamlTags = (tags: string[]) => {
	if (!tags.length) return '[]';
	return `[${tags.map(formatYamlScalar).join(', ')}]`;
};

export const serializeFrontmatter = (fields: ParsedFrontmatter): string => {
	const lines = [
		`title: ${formatYamlScalar(fields.title)}`,
		`date: ${fields.date || '1970-01-01'}`,
		`tags: ${yamlTags(fields.tags)}`,
		`publish: ${fields.publish ? 'true' : 'false'}`
	];
	if (fields.pin) lines.push('pin: true');
	if (fields.deleteRequested) lines.push('delete: true');
	const custom = fields.custom.trim();
	if (custom) lines.push(custom);
	return lines.join('\n');
};
