// Pure text helpers, safe to import from the browser. The hash lives in post-text.ts, which needs node:crypto.
const frontmatterPattern = /^---\r?\n([\s\S]*?)\r?\n---\r?\n(?:\r?\n)*/;

export const splitRawPost = (raw: string) => {
	const match = raw.match(frontmatterPattern);
	return { frontmatter: match?.[1] ?? '', body: match ? raw.slice(match[0].length) : raw };
};

export const canonicalBody = (body: string) => body.replace(/^\n+/, '').replace(/\s+$/, '');

export const renderPost = (frontmatter: string, body: string) => {
	const cleanFrontmatter = frontmatter.trim();
	const cleanBody = canonicalBody(body);
	return cleanFrontmatter ? `---\n${cleanFrontmatter}\n---\n\n${cleanBody}\n` : `${cleanBody}\n`;
};
