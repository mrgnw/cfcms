<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { Editor, type EditorInstance, type PresentationMode } from '@voithos-labs/aragonite';
	import { plugins } from '#lib/aragonite/plugins.js';
	import '@fontsource/ibm-plex-mono/400.css';
	import '@fontsource/ibm-plex-mono/500.css';

	type Props = {
		value: string;
		onChange?: (markdown: string) => void;
	};

	let { value, onChange }: Props = $props();

	// A new object on every load, so a write of the same text still reaches the editor
	// (Aragonite consumer guide, "Loading another document").
	let doc = $state({ text: untrack(() => value) });
	let editor = $state<EditorInstance>();
	let theme = $state<'light' | 'dark'>('light');

	const MODE_KEY = 'xccms:aragonite-mode';
	const modes: PresentationMode[] = ['live', 'preview-inline', 'preview-block', 'source', 'reading'];
	let mode = $state<PresentationMode>('live');

	onMount(() => {
		try {
			const saved = localStorage.getItem(MODE_KEY) as PresentationMode | null;
			if (saved && modes.includes(saved)) mode = saved;
		} catch {}
		const dark = matchMedia('(prefers-color-scheme: dark)');
		const sync = () => (theme = dark.matches ? 'dark' : 'light');
		sync();
		dark.addEventListener('change', sync);
		return () => dark.removeEventListener('change', sync);
	});

	$effect(() => {
		if (!editor) return;
		const ed = editor;
		return ed.getEvents().on('edit', () => onChange?.(ed.getSource()));
	});

	function setMode(next: PresentationMode) {
		mode = next;
		try {
			localStorage.setItem(MODE_KEY, next);
		} catch {}
	}

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

<div class="aragonite-bar">
	<label>
		Mode
		<select value={mode} onchange={(e) => setMode(e.currentTarget.value as PresentationMode)}>
			{#each modes as m (m)}
				<option value={m}>{m}</option>
			{/each}
		</select>
	</label>
</div>

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
	.aragonite-bar {
		display: flex;
		justify-content: flex-end;
		max-width: 68ch;
		margin: 0 auto 8px;
		font-family: var(--font-ui);
		font-size: 12px;
		color: var(--ink-2);
	}

	.aragonite-bar select {
		font: inherit;
		margin-left: 4px;
	}

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
	}
</style>
