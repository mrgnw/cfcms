import assert from 'node:assert/strict';
import { canonicalBody, hashPostContent, renderPost, splitRawPost } from './post-text.ts';

assert.deepEqual(splitRawPost('---\nt: x\n---\n\nBody.\n'), { frontmatter: 't: x', body: 'Body.\n' }, 'blank separator line consumed');
assert.deepEqual(splitRawPost('---\nt: x\n---\n\n\n\nBody.\n'), { frontmatter: 't: x', body: 'Body.\n' }, 'accumulated blank lines from the old bug consumed');
assert.deepEqual(splitRawPost('---\nt: x\n---\nBody.\n'), { frontmatter: 't: x', body: 'Body.\n' }, 'no separator line still parses');
assert.deepEqual(splitRawPost('Just body.\n'), { frontmatter: '', body: 'Just body.\n' }, 'no frontmatter');

assert.equal(canonicalBody('\n\nHello.\n\n'), 'Hello.', 'leading blanks and trailing whitespace stripped');

assert.equal(renderPost('t: x', 'Body.'), '---\nt: x\n---\n\nBody.\n');
assert.equal(renderPost('', 'Body.'), 'Body.\n');
assert.equal(renderPost(' t: x \n', '\nBody.\n\n'), '---\nt: x\n---\n\nBody.\n', 'render canonicalizes both parts');

const fm = 'title: x';
const body = 'Hello.\n\nWorld.';
const roundTrip = splitRawPost(renderPost(fm, body));
assert.equal(hashPostContent(roundTrip.frontmatter, roundTrip.body), hashPostContent(fm, body), 'render→parse→hash is a fixed point');
assert.equal(hashPostContent(fm, '\n\nHello.'), hashPostContent(fm, 'Hello.'), 'legacy leading-newline bodies hash like clean ones');

console.log('post-text.check: ok');
