import assert from 'node:assert/strict';
import { diffSegments, foldContext, lineDiff, lineDiffCounts } from './segment-diff.ts';

const base = 'Alpha paragraph.\n\nBeta paragraph.\n\nGamma paragraph.';

assert.deepEqual(diffSegments(base, base, base), [], 'identical everywhere → nothing');

assert.deepEqual(
	diffSegments(base, base, 'Alpha paragraph.\n\nNew thought.\n\nBeta paragraph.\n\nGamma paragraph.'),
	[{ kind: 'added', theirs: 'New thought.', afterMain: 'Alpha paragraph.' }],
	'they added a block'
);

assert.deepEqual(
	diffSegments(base, base, 'Alpha paragraph, reworded.\n\nBeta paragraph.\n\nGamma paragraph.'),
	[{ kind: 'modified', yours: 'Alpha paragraph.', theirs: 'Alpha paragraph, reworded.' }],
	'they modified a block'
);

assert.deepEqual(
	diffSegments(base, base, 'Alpha paragraph.\n\nGamma paragraph.'),
	[{ kind: 'removed', yours: 'Beta paragraph.' }],
	'they removed a block'
);

assert.deepEqual(
	diffSegments(base, base, 'Beta paragraph.\n\nAlpha paragraph.\n\nGamma paragraph.'),
	[],
	'a move alone is not a difference'
);

assert.deepEqual(
	diffSegments(base, 'Alpha paragraph.\n\nBeta, edited by you.\n\nGamma paragraph.', base),
	[],
	'stale version (they changed nothing, you moved on) → nothing to pull'
);

assert.deepEqual(
	diffSegments(
		base,
		'Alpha, your rewrite.\n\nBeta paragraph.\n\nGamma paragraph.',
		'Alpha, their rewrite.\n\nBeta paragraph.\n\nGamma paragraph.'
	),
	[{ kind: 'conflict', theirs: 'Alpha, their rewrite.', afterMain: null }],
	'both rewrote the same base block → conflict, anchored where it sat'
);

assert.deepEqual(
	diffSegments(base, 'Alpha paragraph.\n\nShared addition.\n\nBeta paragraph.\n\nGamma paragraph.',
		'Alpha paragraph.\n\nShared addition.\n\nBeta paragraph.\n\nGamma paragraph.'),
	[],
	'both added the same block → converged, nothing'
);

const big = Array.from({ length: 501 }, (_, i) => `Block ${i}.`).join('\n\n');
assert.equal(diffSegments(big, big, big), null, 'over the block cap → null fallback');

assert.deepEqual(lineDiffCounts('a\nb\nc', 'a\nx\nc\nd'), { added: 2, deleted: 1 }, 'line counts via LCS');
assert.deepEqual(lineDiffCounts('same', 'same'), { added: 0, deleted: 0 });
assert.equal(lineDiffCounts(Array.from({ length: 4001 }, () => 'l').join('\n'), 'x'), null, 'over the line cap → null');

console.log('segment-diff.check: ok');

assert.deepEqual(
	lineDiff('a\nb\nc', 'a\nx\nc\nd'),
	[
		{ kind: 'same', text: 'a' },
		{ kind: 'del', text: 'b' },
		{ kind: 'add', text: 'x' },
		{ kind: 'same', text: 'c' },
		{ kind: 'add', text: 'd' }
	],
	'line diff via LCS'
);
assert.deepEqual(lineDiff('', 'new'), [{ kind: 'add', text: 'new' }], 'empty before is all added');
assert.deepEqual(
	foldContext(lineDiff('1\n2\n3\n4\n5\n6', '1\n2\n3\nX\n5\n6')!, 1),
	[
		{ kind: 'skip', count: 2 },
		{ kind: 'same', text: '3' },
		{ kind: 'del', text: '4' },
		{ kind: 'add', text: 'X' },
		{ kind: 'same', text: '5' },
		{ kind: 'skip', count: 1 }
	],
	'fold keeps one line of context'
);
assert.deepEqual(foldContext(lineDiff('a\nb', 'a\nb')!, 0), [{ kind: 'skip', count: 2 }], 'identical folds to one skip');
