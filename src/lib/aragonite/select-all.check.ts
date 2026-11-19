import assert from 'node:assert/strict';

const dist = new URL('../../../node_modules/@voithos-labs/aragonite/dist/', import.meta.url);
const { parse } = await import(new URL('core/parser.js', dist).href);
const { createCrossBlockKeydown } = await import(new URL('selection/cross-block/keydown.js', dist).href);
const { cellKeydownPlan } = await import(new URL('components/blocks/table/cell-keydown-plan.js', dist).href);
const { normalizeKeybindingOverrides } = await import(new URL('schema/keybinding-overrides.js', dist).href);

const doc = parse('First paragraph.\n\nLast paragraph.\n');
const overrides = normalizeKeybindingOverrides(undefined);

function selectAll(init: { metaKey?: boolean; ctrlKey?: boolean }) {
	const entered: unknown[] = [];
	const selection = {
		isCrossBlock: false,
		isCustomRendered: true,
		selectAllCount: 0,
		focus: null,
		batch: (run: () => void) => run(),
		incrementSelectAllCount() {
			selection.selectAllCount += 1;
		},
		enterCrossBlock: (anchor: unknown, focus: unknown) => entered.push({ anchor, focus }),
		cellLandingFor: (point: unknown) => point,
		clear() {},
		announcePlacement() {}
	};
	const keydown = createCrossBlockKeydown({
		selection,
		caretWriter: { clear() {}, selectSurfaceContent() {} },
		getDoc: () => doc,
		getEl: () => ({}),
		getMyPath: () => [0],
		getBlockElByPath: () => null,
		reading: { mode: 'live' },
		caretMemory: { noteKey() {} },
		commands: { keybindingOverrides: () => overrides, activation: {} }
	});
	let prevented = false;
	const event = { key: 'a', ...init, preventDefault: () => (prevented = true) };
	return keydown.handleKeyDown(event).then((handled: boolean) => ({ handled, prevented, entered }));
}

const wholeDocument = [{ anchor: { path: [0], offset: 0 }, focus: { path: [1], offset: 15 } }];
for (const init of [{ metaKey: true }, { ctrlKey: true }]) {
	const result = await selectAll(init);
	assert.deepEqual(result, { handled: true, prevented: true, entered: wholeDocument });
}

const cell = { rowIdx: 0, colIdx: 0, offset: 0, contentStart: 0, contentEnd: 1, collapsed: true, columnCount: 2, rowCount: 2, selectAllCount: 0 };
assert.deepEqual(cellKeydownPlan({ key: 'a', metaKey: true }, cell), { kind: 'select-all-step', step: 'document' });
assert.deepEqual(cellKeydownPlan({ key: 'a', ctrlKey: true }, cell), { kind: 'select-all-step', step: 'document' });
