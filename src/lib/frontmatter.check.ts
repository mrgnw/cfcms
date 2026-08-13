import assert from 'node:assert/strict';
import { parseFrontmatter, serializeFrontmatter, setDeleteFlag } from './frontmatter.ts';

const raw = `title: 'Simple… where?'
date: 2026-08-05
tags: [Software, principles]
publish: true
pin: true
draft_of: notes/simple.md`;

const trashed = setDeleteFlag(raw, true);
assert.ok(trashed.includes('delete: true'));
assert.ok(trashed.includes('publish: true'), 'publish survives so restore is lossless');
assert.ok(trashed.includes('draft_of: notes/simple.md'), 'custom keys survive');
assert.equal(setDeleteFlag(trashed, false), raw, 'trash then restore round-trips exactly');

assert.equal(setDeleteFlag(raw, false), raw, 'restoring a live post is a no-op');
assert.equal(
	setDeleteFlag(trashed, true).match(/^delete: true$/gm)?.length,
	1,
	'trashing twice does not duplicate the flag'
);
assert.equal(setDeleteFlag('publish: false\ndeleted: true', false), 'publish: false', 'legacy key cleared');
assert.equal(setDeleteFlag('publish: false\n\n', true), 'publish: false\ndelete: true', 'no blank line gap');
assert.equal(setDeleteFlag('', true), 'delete: true');

const parsed = parseFrontmatter(trashed);
assert.equal(parsed.deleteRequested, true);
assert.equal(parsed.title, 'Simple… where?');
assert.equal(parsed.custom, 'draft_of: notes/simple.md');
assert.deepEqual(parsed.tags, ['Software', 'principles']);

assert.deepEqual(parseFrontmatter(serializeFrontmatter(parsed)), parsed, 'serialize round-trips');
assert.equal(parseFrontmatter(setDeleteFlag(trashed, false)).deleteRequested, false);

console.log('frontmatter.check: ok');
