import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
const win = dom.window as unknown as Record<string, unknown>;
for (const key of Object.getOwnPropertyNames(win)) {
	if (key in globalThis) continue;
	try {
		(globalThis as Record<string, unknown>)[key] = win[key];
	} catch {}
}
for (const name of ['Event', 'CustomEvent', 'EventTarget', 'KeyboardEvent', 'MouseEvent', 'InputEvent', 'FocusEvent'])
	(globalThis as Record<string, unknown>)[name] = win[name];
for (const name of ['addEventListener', 'removeEventListener', 'dispatchEvent'] as const)
	(globalThis as Record<string, unknown>)[name] = dom.window[name].bind(dom.window);
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
dom.window.document.createRange = () => {
	const range = new dom.window.Range();
	range.getBoundingClientRect = () => ({}) as DOMRect;
	range.getClientRects = () => [] as unknown as DOMRectList;
	return range;
};
dom.window.HTMLElement.prototype.getClientRects = () => [] as unknown as DOMRectList;
for (const name of ['IntersectionObserver', 'ResizeObserver'])
	(globalThis as Record<string, unknown>)[name] = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};

const { Crepe } = await import('@milkdown/crepe');
const { editorViewCtx } = await import('@milkdown/kit/core');
const { fenceMeta } = await import('./fence-meta.ts');

async function editIntro(markdown: string) {
	const root = document.createElement('div');
	document.body.append(root);
	const crepe = new Crepe({ root, defaultValue: markdown });
	crepe.editor.use(fenceMeta);
	await crepe.create();
	crepe.editor.action((ctx) => {
		const view = ctx.get(editorViewCtx);
		view.dispatch(view.state.tr.insertText('New ', 1));
	});
	const saved = crepe.getMarkdown();
	await crepe.destroy();
	root.remove();
	return saved;
}

const withMeta = ['Intro', '', '```py {2} title="x.py" caption="Run it"', 'a = 1', 'b = 2', '```', '', 'Outro', ''].join('\n');
assert.equal(await editIntro(withMeta), withMeta.replace('Intro', 'New Intro'));

const plain = ['Intro', '', '```sh', 'ls', '```', '', 'Outro', ''].join('\n');
assert.equal(await editIntro(plain), plain.replace('Intro', 'New Intro'));

console.log('fence-meta ok');
