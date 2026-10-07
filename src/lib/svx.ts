import { formatYamlScalar, parseFrontmatter } from './frontmatter.ts';
import { canonicalBody } from './post-body.ts';

export const slugify = (value: string) =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '') || 'untitled';

export const slugKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

const baseName = (postPath: string) => postPath.replace(/\.md$/, '').split('/').at(-1) ?? '';

const readSlugField = (frontmatter: string) => {
	const line = frontmatter.split(/\r?\n/).find((item) => /^slug:\s*/.test(item));
	return line ? line.replace(/^slug:\s*/, '').trim().replace(/^['"]|['"]$/g, '') : '';
};

export const svxSlug = (postPath: string, frontmatter: string) =>
	slugify(readSlugField(frontmatter) || baseName(postPath));

const isSlugLine = (line: string) => /^slug:/.test(line);

export const renderSvx = (frontmatter: string, body: string) => {
	const fields = parseFrontmatter(frontmatter);
	const lines = [`title: ${JSON.stringify(fields.title)}`, `date: ${JSON.stringify(fields.date || '1970-01-01')}`];
	if (fields.tags[0]) lines.push(`tag: ${JSON.stringify(fields.tags[0])}`);
	if (fields.pin) lines.push('pinned: true');
	lines.push('published: true');
	const custom = fields.custom
		.split('\n')
		.filter((line) => line.trim() && !isSlugLine(line));
	lines.push(...custom);
	return `---\n${lines.join('\n')}\n---\n\n${canonicalBody(body)}\n`;
};

export const svxToPostFrontmatter = (svxFrontmatter: string, slug: string) => {
	const standard: string[] = [];
	const custom: string[] = [];
	for (const line of svxFrontmatter.split(/\r?\n/)) {
		const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
		if (!match) {
			if (line.trim()) custom.push(line);
			continue;
		}
		const [, key, value] = match;
		if (key === 'title' || key === 'date') standard.push(`${key}: ${value.trim()}`);
		else if (key === 'tag') standard.push(`tags: [${value.trim()}]`);
		else if (key === 'pinned') {
			if (value.trim() === 'true') standard.push('pin: true');
		} else if (key === 'published' || key === 'slug') continue;
		else custom.push(line);
	}
	return [...standard, 'publish: true', `slug: ${formatYamlScalar(slug)}`, ...custom].join('\n');
};
