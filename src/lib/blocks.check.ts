import assert from 'node:assert/strict';
import { insertBlock, normalizeBlock, splitBlocks } from './blocks.ts';

const llmDraft = `Intro paragraph.

## Setup

\`\`\`sh
echo one

echo two
\`\`\`

- item a
- item b

Closing thoughts.`;

const llmBlocks = splitBlocks(llmDraft);
assert.equal(llmBlocks.length, 5);
assert.equal(llmBlocks[1], '## Setup');
assert.ok(llmBlocks[2].includes('echo one\n\necho two'), 'fence keeps inner blank lines');
assert.equal(llmBlocks[3], '- item a\n- item b');

assert.equal(normalizeBlock('  a\n b  '), 'a b');

const empty = insertBlock('', llmBlocks, 0);
assert.equal(empty, 'Intro paragraph.');

const afterAnchor = insertBlock('Intro paragraph.\n\nMy own notes.', llmBlocks, 1);
assert.equal(afterAnchor, 'Intro paragraph.\n\n## Setup\n\nMy own notes.');

const beforeNextAnchor = insertBlock('## Setup\n\nMy own notes.', llmBlocks, 0);
assert.equal(beforeNextAnchor, 'Intro paragraph.\n\n## Setup\n\nMy own notes.');

const noAnchor = insertBlock('Unrelated stub.', llmBlocks, 4);
assert.equal(noAnchor, 'Unrelated stub.\n\nClosing thoughts.');

assert.throws(() => insertBlock('', llmBlocks, 99));

console.log('blocks.check: ok');
