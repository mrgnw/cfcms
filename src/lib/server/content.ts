import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { formatYamlScalar, parseYamlScalar } from '$lib/frontmatter';
import { getEditingOrder, pruneMissingPosts, seedEditingQueue } from './db';
import { getDeployStatus, hashPostContent, readDeployState, type DeployState, type DeployStatus } from './deploy-state';
import { contentBaseDirectory, contentDirectory } from './paths';

export type PostSummary = {
	path: string;
	title: string;
	date: string;
	tags: string[];
	publish: boolean;
	pin: boolean;
	editingOrder: number | null;
	deleteRequested: boolean;
	slug: string;
	excerpt: string;
	updatedAt: string;
	contentHash: string;
	deployStatus: DeployStatus;
	deployedAt?: string;
	baselineCommit: string | null;
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

const readFrontmatterValue = (frontmatter: string, key: string) => {
	const line = frontmatter.split(/\r?\n/).find((item) => item.match(new RegExp(`^${key}:\\s*`)));

	if (!line) return '';

	return parseYamlScalar(line.replace(new RegExp(`^${key}:\\s*`), ''));
};

const readBoolean = (frontmatter: string, key: string) => readFrontmatterValue(frontmatter, key) === 'true';

const readTags = (frontmatter: string) => {
	const raw = readFrontmatterValue(frontmatter, 'tags');
	const value = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw;

	return value
		.split(',')
		.map((tag) => parseYamlScalar(tag))
		.filter(Boolean);
};

const getExcerpt = (body: string) =>
	body
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find((line) => line && !line.startsWith('#'))
		?.slice(0, 160) ?? '';

const parsePost = async (
	filePath: string,
	deployState: DeployState,
	editingOrder: Map<string, number>
): Promise<Post> => {
	const raw = await readFile(filePath, 'utf8');
	const match = raw.match(frontmatterPattern);
	const frontmatter = match?.[1] ?? '';
	const body = match ? raw.slice(match[0].length) : raw;
	const metadata = await stat(filePath);
	const postPath = normalizePostPath(relative(contentDirectory, filePath));
	const fallbackTitle = postPath.replace(/\.md$/, '').split('/').at(-1)?.replaceAll('-', ' ') ?? 'Untitled';
	const contentHash = hashPostContent(frontmatter, body);
	const publish = readBoolean(frontmatter, 'publish');
	const deleteRequested = readBoolean(frontmatter, 'delete') || readBoolean(frontmatter, 'deleted');
	const deployed = deployState.posts[postPath];

	return {
		path: postPath,
		title: readFrontmatterValue(frontmatter, 'title') || fallbackTitle,
		date: readFrontmatterValue(frontmatter, 'date'),
		tags: readTags(frontmatter),
		publish,
		pin: readBoolean(frontmatter, 'pin') || readBoolean(frontmatter, 'pinned'),
		editingOrder: editingOrder.get(postPath) ?? null,
		deleteRequested,
		slug: readFrontmatterValue(frontmatter, 'slug') || postPath.replace(/\.md$/, ''),
		excerpt: getExcerpt(body),
		updatedAt: metadata.mtime.toISOString(),
		contentHash,
		deployStatus: getDeployStatus({ publish, deleteRequested, contentHash }, deployed),
		deployedAt: deployed?.deployedAt,
		baselineCommit: deployed?.commit ?? null,
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

export const listPosts = async () => {
	const [files, deployState] = await Promise.all([listMarkdownFiles(contentDirectory), readDeployState()]);
	const fileSet = new Set(files);
	const postFiles = files.filter(
		(file) => !(file.endsWith('.llm.md') && fileSet.has(file.replace(/\.llm\.md$/, '.md')))
	);
	let order = getEditingOrder();
	let posts = await Promise.all(postFiles.map((file) => parsePost(file, deployState, order)));

	pruneMissingPosts(new Set(posts.map((post) => post.path)));

	const legacyEditPaths = posts
		.filter((post) => readBoolean(post.frontmatter, 'edit'))
		.map((post) => post.path);

	if (seedEditingQueue(legacyEditPaths)) {
		order = getEditingOrder();
		posts = posts.map((post) => ({ ...post, editingOrder: order.get(post.path) ?? null }));
	}

	return posts.sort((first, second) => {
		const firstDate = first.date || first.updatedAt;
		const secondDate = second.date || second.updatedAt;

		return secondDate.localeCompare(firstDate);
	});
};

export const getPost = async (postPath: string) =>
	parsePost(getPostFilePath(postPath), await readDeployState(), getEditingOrder());

export const createUserVersion = async (llmPath: string) => {
	if (!llmPath.endsWith('.llm.md')) throw new Error('Can only fork .llm.md drafts');

	const userPath = llmPath.replace(/\.llm\.md$/, '.md');
	const userFilePath = getPostFilePath(userPath);

	try {
		await stat(userFilePath);
		return userPath;
	} catch {
		// sibling missing — create it below
	}

	const raw = await readFile(getPostFilePath(llmPath), 'utf8');
	const frontmatter = (raw.match(frontmatterPattern)?.[1] ?? '')
		.split(/\r?\n/)
		.filter((line) => !line.match(/^publish:/))
		.join('\n')
		.trim();

	await writeFile(userFilePath, frontmatter ? `---\n${frontmatter}\n---\n\n` : '', 'utf8');
	return userPath;
};

export const getLlmDraft = async (postPath: string) => {
	if (postPath.endsWith('.llm.md')) return null;

	const companionPath = postPath.replace(/\.md$/, '.llm.md');

	try {
		const raw = await readFile(getPostFilePath(companionPath), 'utf8');
		const match = raw.match(frontmatterPattern);

		return {
			path: companionPath,
			body: match ? raw.slice(match[0].length) : raw
		};
	} catch {
		return null;
	}
};

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

export const deletePostFile = async (postPath: string) => {
	await unlink(getPostFilePath(postPath));
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
		`---\ntitle: ${formatYamlScalar(title)}\ndate: ${date}\ntags: \npublish: false\n---\n\n`,
		'utf8'
	);

	return getPost(postPath);
};
