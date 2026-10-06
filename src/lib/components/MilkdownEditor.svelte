<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Crepe, CrepeFeature } from '@milkdown/crepe';
	import { replaceAll, insert, insertPos } from '@milkdown/kit/utils';
	import { editorViewCtx } from '@milkdown/kit/core';
	import { codeBlockConfig } from '@milkdown/kit/component/code-block';
	import { languages, theme } from '$lib/code/twinkleplop';
	import { fenceMeta } from '$lib/code/fence-meta';
	import '$blog/styles/code-theme.css';
	import type { EditorView } from '@milkdown/kit/prose/view';
	import '@milkdown/crepe/theme/common/style.css';
	import '@milkdown/crepe/theme/frame.css';

	type Props = {
		value: string;
		onChange?: (markdown: string) => void;
	};

	let { value, onChange }: Props = $props();

	let host: HTMLDivElement;
	let crepe: Crepe | null = null;
	let view: EditorView | null = null;

	onMount(async () => {
		crepe = new Crepe({
			root: host,
			defaultValue: value,
			featureConfigs: {
				[CrepeFeature.Placeholder]: {
					text: 'Write the post...',
					mode: 'doc'
				},
				[CrepeFeature.CodeMirror]: { theme }
			}
		});
		// README.md "Code blocks": why One Dark is replaced via theme and languages are set here
		crepe.editor.config((ctx) => ctx.update(codeBlockConfig.key, (config) => ({ ...config, languages })));
		crepe.editor.use(fenceMeta);
		crepe.on((listener) => {
			listener.markdownUpdated((_, md) => {
				onChange?.(md);
			});
		});
		await crepe.create();
		crepe.editor.action((ctx) => (view = ctx.get(editorViewCtx)));
	});

	const acceptsDrag = (e: DragEvent) =>
		Array.from(e.dataTransfer?.types ?? []).includes('application/x-ref-md');

	function onDragOver(e: DragEvent) {
		if (!acceptsDrag(e)) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
	}

	function snapToWordBoundary(editorView: EditorView, pos: number) {
		const resolved = editorView.state.doc.resolve(pos);
		if (!resolved.parent.isTextblock) return pos;

		const text = resolved.parent.textContent;
		const offset = resolved.parentOffset;
		const isWord = (char: string | undefined) => Boolean(char && /\S/.test(char));
		if (offset <= 0 || offset >= text.length) return pos;
		if (!isWord(text[offset - 1]) || !isWord(text[offset])) return pos;

		let left = offset;
		let right = offset;
		while (left > 0 && isWord(text[left - 1])) left--;
		while (right < text.length && isWord(text[right])) right++;

		return pos + (offset - left <= right - offset ? left - offset : right - offset);
	}

	function onDrop(e: DragEvent) {
		const md = e.dataTransfer?.getData('application/x-ref-md');
		if (!md || !crepe || !view) return;
		e.preventDefault();
		const inline = e.dataTransfer?.getData('application/x-ref-inline') === '1';
		const at = view.posAtCoords({ left: e.clientX, top: e.clientY });
		const pos = at ? at.pos : view.state.selection.to;
		crepe.editor.action(insertPos(md, snapToWordBoundary(view, pos), inline));
		view.focus();
	}

	onDestroy(() => {
		crepe?.destroy();
	});

	export function setContent(markdown: string) {
		crepe?.editor.action(replaceAll(markdown, true));
	}

	export function insertMarkdown(markdown: string, inline = false) {
		if (!crepe) return;
		crepe.editor.action(insert(markdown, inline));
		crepe.editor.action((ctx) => ctx.get(editorViewCtx).focus());
	}
</script>

<div
	class="milkdown-host"
	bind:this={host}
	role="group"
	aria-label="Post body editor"
	ondragover={onDragOver}
	ondrop={onDrop}
></div>

<style>
	.milkdown-host {
		min-height: 60vh;
	}

	.milkdown-host :global(.milkdown) {
		--crepe-color-background: transparent;
		--crepe-color-on-background: var(--ink);
		--crepe-color-surface: var(--bg);
		--crepe-color-surface-low: var(--hover);
		--crepe-color-on-surface: var(--ink);
		--crepe-color-on-surface-variant: var(--ink-2);
		--crepe-color-outline: var(--ink-3);
		--crepe-color-primary: var(--accent);
		--crepe-color-secondary: var(--hover);
		--crepe-color-on-secondary: var(--ink);
		--crepe-color-inverse: var(--ink);
		--crepe-color-on-inverse: var(--paper);
		--crepe-color-inline-code: var(--accent-ink);
		--crepe-color-error: var(--danger);
		--crepe-color-hover: var(--hover);
		--crepe-color-selected: var(--hover);
		--crepe-color-inline-area: var(--line);
		--crepe-font-title: var(--font-display);
		--crepe-font-default: var(--font-display);
		--crepe-font-code: var(--font-mono);
		--crepe-shadow-1: 0 1px 3px 1px var(--shadow);
		--crepe-shadow-2: 0 2px 6px 2px var(--shadow);
		background: transparent;
	}

	.milkdown-host :global(.ProseMirror) {
		outline: none;
		padding: 0;
		max-width: 68ch;
		margin-inline: auto;
		font-size: 17px;
		line-height: 1.7;
		caret-color: var(--accent);
	}

	.milkdown-host :global(.ProseMirror ::selection),
	.milkdown-host :global(.ProseMirror::selection) {
		background: color-mix(in srgb, var(--accent) 18%, transparent);
	}

	.milkdown-host :global(.milkdown-code-block) {
		--crepe-color-surface: var(--twp-background);
		--crepe-color-on-surface: var(--twp-identifier);
		border: 1px solid var(--line);
		border-radius: 8px;
	}
</style>
