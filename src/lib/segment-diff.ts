import { normalizeBlock, splitBlocks } from './blocks.ts';

export type Segment =
	| { kind: 'added'; theirs: string; afterMain: string | null }
	| { kind: 'removed'; yours: string }
	| { kind: 'modified'; yours: string; theirs: string }
	| { kind: 'conflict'; theirs: string; afterMain: string | null };

const maxDiffBlocks = 500;

const lcsPairs = (a: string[], b: string[]): [number, number][] => {
	const n = a.length;
	const m = b.length;
	const table = new Uint32Array((n + 1) * (m + 1));
	const at = (i: number, j: number) => i * (m + 1) + j;

	for (let i = n - 1; i >= 0; i -= 1) {
		for (let j = m - 1; j >= 0; j -= 1) {
			table[at(i, j)] = a[i] === b[j] ? table[at(i + 1, j + 1)] + 1 : Math.max(table[at(i + 1, j)], table[at(i, j + 1)]);
		}
	}

	const pairs: [number, number][] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[i] === b[j]) {
			pairs.push([i, j]);
			i += 1;
			j += 1;
		} else if (table[at(i + 1, j)] >= table[at(i, j + 1)]) {
			i += 1;
		} else {
			j += 1;
		}
	}
	return pairs;
};

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, k) => from + k);

export const diffSegments = (baseBody: string, mainBody: string, versionBody: string): Segment[] | null => {
	const baseBlocks = splitBlocks(baseBody);
	const mainBlocks = splitBlocks(mainBody);
	const versionBlocks = splitBlocks(versionBody);

	if (Math.max(baseBlocks.length, mainBlocks.length, versionBlocks.length) > maxDiffBlocks) return null;

	const bN = baseBlocks.map(normalizeBlock);
	const mN = mainBlocks.map(normalizeBlock);
	const vN = versionBlocks.map(normalizeBlock);
	const baseSet = new Set(bN);
	const mainSet = new Set(mN);
	const versionSet = new Set(vN);

	const baseInMain = new Map(lcsPairs(bN, mN));
	const mainRawFor = (norm: string) => {
		const idx = mN.indexOf(norm);
		return idx >= 0 ? mainBlocks[idx] : null;
	};

	const anchorFor = (vIdx: number): string | null => {
		for (let w = vIdx - 1; w >= 0; w -= 1) {
			if (mainSet.has(vN[w])) return mainRawFor(vN[w]);
		}
		return null;
	};

	const bv = lcsPairs(bN, vN);
	const walk: [number, number][] = [[-1, -1], ...bv, [bN.length, vN.length]];
	const segments: Segment[] = [];

	for (let k = 0; k + 1 < walk.length; k += 1) {
		const [bStart, vStart] = walk[k];
		const [bEnd, vEnd] = walk[k + 1];

		const deleted = range(bStart + 1, bEnd).filter((bIdx) => !versionSet.has(bN[bIdx]));
		const inserted = range(vStart + 1, vEnd).filter((vIdx) => !mainSet.has(vN[vIdx]) && !baseSet.has(vN[vIdx]));

		const pairCount = Math.min(deleted.length, inserted.length);

		for (let p = 0; p < pairCount; p += 1) {
			const bIdx = deleted[p];
			const vIdx = inserted[p];
			const mainIdx = baseInMain.get(bIdx);

			if (mainIdx == null) {
				segments.push({ kind: 'conflict', theirs: versionBlocks[vIdx], afterMain: anchorFor(vIdx) });
			} else {
				segments.push({ kind: 'modified', yours: mainBlocks[mainIdx], theirs: versionBlocks[vIdx] });
			}
		}

		for (let p = pairCount; p < deleted.length; p += 1) {
			const mainIdx = baseInMain.get(deleted[p]);
			if (mainIdx == null) continue;
			segments.push({ kind: 'removed', yours: mainBlocks[mainIdx] });
		}

		for (let p = pairCount; p < inserted.length; p += 1) {
			const vIdx = inserted[p];
			segments.push({ kind: 'added', theirs: versionBlocks[vIdx], afterMain: anchorFor(vIdx) });
		}
	}

	return segments;
};

const maxDiffLines = 4000;

export const lineDiffCounts = (before: string, after: string): { added: number; deleted: number } | null => {
	const a = before.split('\n');
	const b = after.split('\n');
	if (Math.max(a.length, b.length) > maxDiffLines) return null;
	const common = lcsPairs(a, b).length;
	return { added: b.length - common, deleted: a.length - common };
};
