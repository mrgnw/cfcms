import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalBody, hashPostContent, splitRawPost } from '#lib/post-text.js';
import { normalizeNewlines } from '#lib/save-rules.js';
import { slugKey, svxSlug, svxToPostFrontmatter } from '#lib/svx.js';
import {
	appendRevision,
	clearStaged,
	getMetaValue,
	getRevision,
	getStagedPaths,
	listStoredPosts,
	listVersions,
	recordPublished,
	setMetaValue,
	upsertVersion,
	type StoredPost
} from './db';
import { contentBaseDirectory } from './paths';
import { fastForwardSite } from './site-text';

const svxDirectory = resolve(contentBaseDirectory, 'src/posts');
const metaKey = 'importedSvxBaseline';

type LiveEntry = { path: string; title: string; slug: string; contentHash: string };

const readTitle = (frontmatter: string) =>
	frontmatter.split('\n').find((line) => line.startsWith('title:'))?.replace(/^title:\s*/, '').replace(/^['"]|['"]$/g, '') ?? '';

const baseName = (postPath: string) => postPath.replace(/\.md$/, '').split('/').at(-1) ?? '';

const matchStored = (slug: string, stored: StoredPost[]) => {
	const bySlugField = stored.filter((post) => svxSlug(post.path, post.frontmatter) === slug && /^slug:/m.test(post.frontmatter));
	const candidates = bySlugField.length ? bySlugField : stored.filter((post) => slugKey(baseName(post.path)) === slugKey(slug));
	if (candidates.length > 1) throw new Error(`svx baseline: ${slug} matches ${candidates.map((post) => post.path).join(', ')}`);
	return candidates[0] ?? null;
};

const runBaseline = async () => {
	if (getMetaValue(metaKey)) return;

	const names = (await readdir(svxDirectory).catch(() => [] as string[])).filter((name) => name.endsWith('.svx')).sort();
	if (names.length === 0) {
		setMetaValue(metaKey, new Date().toISOString());
		return;
	}

	const stored = listStoredPosts();
	const report: string[] = ['# svx baseline report', '', `Ran: ${new Date().toISOString()}`, ''];
	const live: LiveEntry[] = [];
	const claimed = new Set<string>();

	for (const name of names) {
		const slug = name.replace(/\.svx$/, '');
		const raw = normalizeNewlines(await readFile(resolve(svxDirectory, name), 'utf8'));
		const split = splitRawPost(raw);
		const mapped = svxToPostFrontmatter(split.frontmatter, slug);
		const svxBody = canonicalBody(split.body);
		const liveHash = hashPostContent(mapped, svxBody);

		const match = matchStored(slug, stored);
		if (match && claimed.has(match.path)) throw new Error(`svx baseline: ${match.path} claimed twice`);

		if (!match) {
			const path = `${slug}.md`;
			appendRevision(path, mapped, svxBody, liveHash, 'import');
			live.push({ path, title: readTitle(mapped), slug, contentHash: liveHash });
			report.push(`- created ${path} from ${name}`);
			continue;
		}

		claimed.add(match.path);
		const sameBody = match.body === svxBody;
		if (!sameBody) appendRevision(match.path, mapped, svxBody, liveHash, 'import');
		const headHash = hashPostContent(mapped, match.body);
		appendRevision(match.path, mapped, match.body, headHash, 'import');
		if (!sameBody) {
			upsertVersion({ path: match.path, writer: 'site', sessionId: 'svx', baseHash: headHash, frontmatter: mapped, body: svxBody });
		}
		live.push({ path: match.path, title: readTitle(mapped), slug, contentHash: liveHash });
		report.push(`- ${match.path} → ${name} (${sameBody ? 'live' : 'changed: head body differs from live'})`);
	}

	const orphans = stored.filter((post) => !claimed.has(post.path) && /^publish: true$/m.test(post.frontmatter));
	if (orphans.length) {
		report.push('', 'publish: true in the store but not live (will show as ready):', ...orphans.map((post) => `- ${post.path}`));
	}

	recordPublished(live, null);
	clearStaged([...getStagedPaths()]);
	setMetaValue(metaKey, new Date().toISOString());
	const reportDirectory = resolve(process.cwd(), '.data');
	await mkdir(reportDirectory, { recursive: true });
	await writeFile(resolve(reportDirectory, 'svx-baseline-report.md'), `${report.join('\n')}\n`, 'utf8');
};

let baselinePromise: Promise<void> | null = null;

export const ensureSvxBaseline = () => {
	baselinePromise ??= runBaseline().catch((caught) => {
		baselinePromise = null;
		throw caught;
	});
	return baselinePromise;
};

const repairKey = 'repairedSiteBase';

const repairSiteBase = async () => {
	if (getMetaValue(repairKey)) return;

	const lines: string[] = ['', `## site base repair (${new Date().toISOString()})`, ''];
	for (const post of listStoredPosts()) {
		if (!listVersions(post.path).some((version) => version.writer === 'site')) continue;
		const base = getRevision(post.path, 1);
		if (!base) throw new Error(`site base repair: ${post.path} has no revision 1`);
		lines.push(`- ${post.path}: ${fastForwardSite(post.path, base.body)}`);
	}

	setMetaValue(repairKey, new Date().toISOString());
	const reportDirectory = resolve(process.cwd(), '.data');
	await mkdir(reportDirectory, { recursive: true });
	await appendFile(resolve(reportDirectory, 'svx-baseline-report.md'), `${lines.join('\n')}\n`, 'utf8');
};

let repairPromise: Promise<void> | null = null;

export const ensureSiteBaseRepaired = () => {
	repairPromise ??= repairSiteBase().catch((caught) => {
		repairPromise = null;
		throw caught;
	});
	return repairPromise;
};
