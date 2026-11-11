<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type { EditorInstance, PresentationMode } from '@voithos-labs/aragonite';
	import { Editor } from '@voithos-labs/aragonite/svelte';
	import { plugins } from '#lib/aragonite/plugins.js';
	import '@fontsource/ibm-plex-mono/400.css';
	import '@fontsource/ibm-plex-mono/500.css';

	type Props = {
		value: string;
		mode: PresentationMode;
		onChange?: (markdown: string) => void;
	};

	let { value, mode, onChange }: Props = $props();

	// A new object on every load, so a write of the same text still reaches the editor
	// (Aragonite consumer guide, "Loading another document").
	let doc = $state({ text: untrack(() => value) });
	let editor = $state<EditorInstance>();
	let theme = $state<'light' | 'dark'>('light');

	onMount(() => {
		const dark = matchMedia('(prefers-color-scheme: dark)');
		const sync = () => (theme = dark.matches ? 'dark' : 'light');
		sync();
		dark.addEventListener('change', sync);
		return () => dark.removeEventListener('change', sync);
	});

	// Editor is never swapped while this component lives, so one subscription at mount covers it.
	onMount(() => {
		const ed = editor;
		if (!ed) throw new Error('Aragonite editor is not bound at mount');
		return ed.getEvents().on('edit', () => onChange?.(ed.getSource()));
	});

	export function setContent(markdown: string) {
		doc = { text: markdown };
	}

	export async function insertMarkdown(markdown: string, inline = false) {
		if (!editor) return;
		const landed = await editor.insertMarkdown(markdown, { placement: inline ? 'caret' : 'below' });
		if (landed) return;
		// No caret in the editor: append, as there is nowhere better to put it.
		const current = editor.getSource().replace(/\s+$/, '');
		const next = current ? `${current}\n\n${markdown}\n` : `${markdown}\n`;
		doc = { text: next };
		onChange?.(next);
	}

	const acceptsDrag = (e: DragEvent) =>
		Array.from(e.dataTransfer?.types ?? []).includes('application/x-ref-md');

	function onDragOver(e: DragEvent) {
		if (!acceptsDrag(e)) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
	}

	function onDrop(e: DragEvent) {
		const md = e.dataTransfer?.getData('application/x-ref-md');
		if (!md || !editor) return;
		e.preventDefault();
		e.stopPropagation();
		const inline = e.dataTransfer?.getData('application/x-ref-inline') === '1';
		editor.placeCaretAtPoint(e.clientX, e.clientY);
		void insertMarkdown(md, inline);
	}
</script>

<div
	class="aragonite-host"
	role="group"
	aria-label="Post body editor"
	ondragovercapture={onDragOver}
	ondropcapture={onDrop}
>
	<Editor
		bind:this={editor}
		source={doc.text}
		{theme}
		presentationMode={mode}
		{plugins}
		scrollMode="host"
	/>
</div>

<style>
	/* Host-chrome tokens from the CMS palette (Aragonite consumer guide, "Theme tokens"). No
	   aragonite-editor-theme wrapper, so these reach the editor directly. */
	.aragonite-host {
		min-height: 60vh;
		max-width: 68ch;
		margin-inline: auto;
		--font-editor: var(--font-display);
		--font-code: 'IBM Plex Mono', ui-monospace, 'SFMono-Regular', monospace;
		--editor-font-size: 17px;
		--radius-ui: 6px;
		--radius-surface: var(--radius);
		--color-bg: var(--bg);
		--color-surface: var(--paper);
		--color-text-primary: var(--ink);
		--color-text-secondary: var(--ink);
		--color-ui-muted: var(--ink-2);
		--color-ui-dulled: var(--ink-3);
		--color-accent: var(--accent);
		--color-selection: var(--accent);
		--color-border: var(--line);
		--color-error: var(--danger);
		--pele-bg: transparent;
		--pele-fg: var(--ink);
		--pele-muted: var(--ink-2);
		--pele-line: var(--ink-2);
		--pele-surface: var(--paper);
		--pele-surface-alt: var(--bg);
		--pele-border: var(--line);
		--pele-accent: var(--accent);
		--pele-font: var(--font-ui);
	}
</style>
