import assert from 'node:assert/strict';
import { applySegment, diffSegments, lineDiffCounts, type Segment } from './segment-diff.ts';

const base = 'Alpha paragraph.\n\nBeta paragraph.\n\nGamma paragraph.';

assert.deepEqual(diffSegments(base, base, base), [], 'identical everywhere → nothing');

assert.deepEqual(
	diffSegments(base, base, 'Alpha paragraph.\n\nNew thought.\n\nBeta paragraph.\n\nGamma paragraph.'),
	[{ kind: 'added', theirs: 'New thought.', afterMain: 'Alpha paragraph.', afterTheirs: [] }],
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
	[{ kind: 'conflict', theirs: 'Alpha, their rewrite.', afterMain: null, afterTheirs: [] }],
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

// applySegment: segment-apply bug repros, with base = main = Alpha., Omega.
const am = 'Alpha.\n\nOmega.';
const applyAll = (body: string, segs: Segment[]) =>
	segs.reduce<string | null>((acc, seg) => (acc == null ? null : applySegment(acc, seg)), body);

const run = diffSegments(am, am, 'Alpha.\n\nOne.\n\nTwo.\n\nThree.\n\nOmega.');
assert.deepEqual(
	run,
	[
		{ kind: 'added', theirs: 'One.', afterMain: 'Alpha.', afterTheirs: [] },
		{ kind: 'added', theirs: 'Two.', afterMain: 'Alpha.', afterTheirs: ['One.'] },
		{ kind: 'added', theirs: 'Three.', afterMain: 'Alpha.', afterTheirs: ['Two.', 'One.'] }
	],
	'an inserted run lists the earlier blocks of the run, nearest first'
);
assert.ok(run);
const [one, two, three] = run;
const inOrder = 'Alpha.\n\nOne.\n\nTwo.\n\nThree.\n\nOmega.';
assert.equal(applyAll(am, [one, two, three]), inOrder, 'accepting a run top to bottom keeps version order');
assert.equal(applyAll(am, [three, two, one]), inOrder, 'accepting a run bottom to top keeps version order');
assert.equal(
	applyAll(am, [three, one]),
	'Alpha.\n\nOne.\n\nThree.\n\nOmega.',
	'skipping the middle block (Three, then One) keeps version order'
);
assert.equal(
	applyAll(am, [one, three]),
	'Alpha.\n\nOne.\n\nThree.\n\nOmega.',
	'skipping the middle block (One, then Three) keeps version order'
);

const anchorEdited = 'Alpha, edited.\n\nOmega.';
assert.equal(applySegment(anchorEdited, one), null, 'a rewritten anchor → null, not the top of the post');
assert.equal(
	applySegment(anchorEdited, { kind: 'conflict', theirs: 'Theirs.', afterMain: 'Alpha.', afterTheirs: [] }),
	null,
	'conflict with a rewritten anchor → null'
);
assert.equal(
	applySegment(am, { kind: 'added', theirs: 'Top.', afterMain: null, afterTheirs: [] }),
	'Top.\n\nAlpha.\n\nOmega.',
	'no anchor → inserted at the top'
);

const targetEdited = 'Alpha, rewritten by you.\n\nOmega.';
assert.equal(applySegment(targetEdited, { kind: 'removed', yours: 'Alpha.' }), null, 'removed with a rewritten target → null');
assert.equal(
	applySegment(targetEdited, { kind: 'modified', yours: 'Alpha.', theirs: 'Alpha, theirs.' }),
	null,
	'modified with a rewritten target → null'
);
assert.equal(applySegment(am, { kind: 'removed', yours: 'Alpha.' }), 'Omega.', 'removed on an unchanged body');
assert.equal(
	applySegment(am, { kind: 'modified', yours: 'Alpha.', theirs: 'Alpha, theirs.' }),
	'Alpha, theirs.\n\nOmega.',
	'modified on an unchanged body'
);

console.log('segment-diff.check: ok');
