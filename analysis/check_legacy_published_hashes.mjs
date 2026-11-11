import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const databasePath = process.argv[2] ?? resolve('.data/cms.db');
const contentDirectory = process.argv[3] ?? resolve(process.env.BLOG_CONTENT_BASE_DIR ?? '../blog', 'content');

const oldPattern = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const newPattern = /^---\r?\n([\s\S]*?)\r?\n---\r?\n(?:\r?\n)*/;

const split = (raw, pattern) => {
	const match = raw.match(pattern);
	return { frontmatter: match?.[1] ?? '', body: match ? raw.slice(match[0].length) : raw };
};

const hash = (frontmatter, body) =>
	createHash('sha256').update(`${frontmatter.trim()}\n---\n${body.replace(/\s+$/, '')}`).digest('hex');

const db = new DatabaseSync(databasePath);
const rows = db
	.prepare('SELECT path, published_hash, published_commit FROM posts WHERE published_hash IS NOT NULL')
	.all();

let matches = 0;
for (const row of rows) {
	let raw = null;
	try {
		raw = readFileSync(resolve(contentDirectory, row.path), 'utf8').replaceAll('\r\n', '\n');
	} catch {
		console.log(`MISSING FILE  ${row.path}`);
		continue;
	}

	const old = split(raw, oldPattern);
	const fixed = split(raw, newPattern);
	const oldHash = hash(old.frontmatter, old.body);
	const matched = oldHash === row.published_hash;
	if (matched) matches += 1;

	console.log(
		`${matched ? 'HEAD-MATCH   ' : 'no match     '} commit=${row.published_commit ?? 'null'}  ${row.path}` +
			(matched ? `  → new hash ${hash(fixed.frontmatter, fixed.body).slice(0, 12)}` : '')
	);
}

console.log(`\n${matches}/${rows.length} published rows resolve from current file content via the old hash.`);
