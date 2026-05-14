import { env } from '$env/dynamic/private';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

export const contentBaseDirectory = env.BLOG_CONTENT_BASE_DIR ?? resolve(process.cwd(), '..', '..');
const contentDirectory = resolve(contentBaseDirectory, 'content');

export type PostSummary = {
	path: string;
	title: string;
	date: string;
	tags: string[];
	publish: boolean;
	pin: boolean;
	slug: string;
	excerpt: string;
	updatedAt: string;
};

export type Post = PostSummary & {
	frontmatter: string;
	body: string;
};

const frontmatterPattern = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

const isMarkdownFile = (filePath: string) => filePath.endsWith('.md');

const normalizePostPath = (postPath: string) => postPath.replaceAll('\\', '/');

export const getPostFilePath = (postPath: string) => {
	const resolved = resolve(contentDirectory, postPath);

	if (resolved !== contentDirectory && !resolved.startsWith(`${contentDirectory}${sep}`)) {
		throw new Error('Post path must stay inside the content directory');
	}

	if (!isMarkdownFile(resolved)) {
		throw new Error('Post path must end in .md');
	}

	return resolved;
};

export const getPostGitPath = (postPath: string) => normalizePostPath(relative(contentBaseDirectory, getPostFilePath(postPath)));

const stripQuotes = (value: string) => value.replace(/^['"]|['"]$/g, '');

const readFrontmatterValue = (frontmatter: string, key: string) => {
	const line = frontmatter.split(/\r?\n/).find((item) => item.match(new RegExp(`^${key}:\\s*`)));

	if (!line) return '';

	return stripQuotes(line.replace(new RegExp(`^${key}:\\s*`), '').trim());
};

const readBoolean = (frontmatter: string, key: string) => readFrontmatterValue(frontmatter, key) === 'true';

const readTags = (frontmatter: string) => {
	const raw = readFrontmatterValue(frontmatter, 'tags');
	const value = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw;

	return value
		.split(',')
		.map((tag) => stripQuotes(tag.trim()))
		.filter(Boolean);
};

const getExcerpt = (body: string) =>
	body
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find((line) => line && !line.startsWith('#'))
		?.slice(0, 160) ?? '';

const parsePost = async (filePath: string): Promise<Post> => {
	const raw = await readFile(filePath, 'utf8');
	const match = raw.match(frontmatterPattern);
	const frontmatter = match?.[1] ?? '';
	const body = match ? raw.slice(match[0].length) : raw;
	const metadata = await stat(filePath);
	const postPath = normalizePostPath(relative(contentDirectory, filePath));
	const fallbackTitle = postPath.replace(/\.md$/, '').split('/').at(-1)?.replaceAll('-', ' ') ?? 'Untitled';

	return {
		path: postPath,
		title: readFrontmatterValue(frontmatter, 'title') || fallbackTitle,
		date: readFrontmatterValue(frontmatter, 'date'),
		tags: readTags(frontmatter),
		publish: readBoolean(frontmatter, 'publish'),
		pin: readBoolean(frontmatter, 'pin') || readBoolean(frontmatter, 'pinned'),
		slug: readFrontmatterValue(frontmatter, 'slug') || postPath.replace(/\.md$/, ''),
		excerpt: getExcerpt(body),
		updatedAt: metadata.mtime.toISOString(),
		frontmatter,
		body
	};
};

const listMarkdownFiles = async (directory: string): Promise<string[]> => {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = await Promise.all(
		entries.map(async (entry) => {
			const filePath = resolve(directory, entry.name);

			if (entry.isDirectory()) return listMarkdownFiles(filePath);
			if (entry.isFile() && isMarkdownFile(filePath)) return [filePath];
			return [];
		})
	);

	return files.flat();
};

const slugify = (value: string) =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '') || 'untitled';

const quoteYamlString = (value: string) => `'${value.replaceAll("'", "''")}'`;

export const listPosts = async () => {
	const files = await listMarkdownFiles(contentDirectory);
	const posts = await Promise.all(files.map(parsePost));

	return posts.sort((first, second) => {
		const firstDate = first.date || first.updatedAt;
		const secondDate = second.date || second.updatedAt;

		return secondDate.localeCompare(firstDate);
	});
};

export const getPost = async (postPath: string) => parsePost(getPostFilePath(postPath));

export const savePost = async (postPath: string, frontmatter: string, body: string) => {
	const filePath = getPostFilePath(postPath);
	const normalizedFrontmatter = frontmatter.trim();
	const normalizedBody = body.replace(/\s+$/, '');
	const content = normalizedFrontmatter
		? `---\n${normalizedFrontmatter}\n---\n\n${normalizedBody}\n`
		: `${normalizedBody}\n`;

	await writeFile(filePath, content, 'utf8');
	return getPost(postPath);
};

export const createPost = async (title: string) => {
	const date = new Date().toISOString().slice(0, 10);
	const baseSlug = slugify(title);
	let postPath = `${baseSlug}.md`;
	let suffix = 2;

	while (true) {
		try {
			await stat(getPostFilePath(postPath));
			postPath = `${baseSlug}-${suffix}.md`;
			suffix += 1;
		} catch {
			break;
		}
	}

	const filePath = getPostFilePath(postPath);
	await mkdir(dirname(filePath), { recursive: true });
	await writeFile(
		filePath,
		`---\ntitle: ${quoteYamlString(title)}\ndate: ${date}\ntags: \npublish: false\n---\n\n`,
		'utf8'
	);

	return getPost(postPath);
};
