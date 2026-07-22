<script lang="ts">
	import { untrack } from 'svelte';
	import { isProse, normalizeBlock, splitBlocks, splitSentences } from '$lib/blocks';

	type Props = {
		path: string;
		body: string;
		userBody: string;
		onInsert: (markdown: string, inline: boolean) => void;
	};

	type Item = { id: number; block: string; prose: boolean; sentences: string[] };
	type DragRef = { kind: 'para'; itemId: number } | { kind: 'sent'; itemId: number; index: number };

	let { path, body, userBody, onInsert }: Props = $props();

	let nextId = 0;
	let items = $state<Item[]>(
		untrack(() =>
			splitBlocks(body).map((block) => ({
				id: nextId++,
				block,
				prose: isProse(block),
				sentences: splitSentences(block)
			}))
		)
	);

	let mode = $state<'insert' | 'copy'>('insert');
	let copiedKey = $state<string | null>(null);
	let copyTimer: ReturnType<typeof setTimeout> | null = null;

	let dragging = $state<DragRef | null>(null);
	let paraHint = $state<{ id: number; where: 'before' | 'after' } | null>(null);
	let sentHint = $state<{ itemId: number; index: number; where: 'before' | 'after' } | null>(null);

	const usedNorm = $derived(normalizeBlock(userBody));
	const isUsed = (text: string) => {
		const norm = normalizeBlock(text);
		return norm.length > 0 && usedNorm.includes(norm);
	};

	function activate(markdown: string, inline: boolean, key: string) {
		if (mode === 'copy') {
			navigator.clipboard?.writeText(markdown).catch(() => {});
			copiedKey = key;
			if (copyTimer) clearTimeout(copyTimer);
			copyTimer = setTimeout(() => (copiedKey = null), 1000);
		} else {
			onInsert(markdown, inline);
		}
	}

	function setDrag(e: DragEvent, markdown: string, inline: boolean) {
		if (!e.dataTransfer) return;
		e.dataTransfer.setData('application/x-ref-md', markdown);
		e.dataTransfer.setData('application/x-ref-inline', inline ? '1' : '0');
		e.dataTransfer.setData('text/plain', markdown);
		e.dataTransfer.effectAllowed = 'copyMove';
	}

	function endDrag() {
		dragging = null;
		paraHint = null;
		sentHint = null;
	}

	function paraDragStart(e: DragEvent, itemId: number, block: string) {
		setDrag(e, block, false);
		dragging = { kind: 'para', itemId };
	}
	function sentDragStart(e: DragEvent, itemId: number, index: number, sentence: string) {
		setDrag(e, sentence, true);
		dragging = { kind: 'sent', itemId, index };
	}

	function paraOver(e: DragEvent, itemId: number) {
		if (dragging?.kind !== 'para') return;
		e.preventDefault();
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		paraHint = { id: itemId, where: e.clientY < rect.top + rect.height / 2 ? 'before' : 'after' };
	}
	function paraDrop(e: DragEvent, itemId: number) {
		if (dragging?.kind !== 'para') return;
		e.preventDefault();
		const from = dragging.itemId;
		const where = paraHint?.where ?? 'before';
		endDrag();
		if (from === itemId) return;
		const moved = items.find((i) => i.id === from);
		if (!moved) return;
		const without = items.filter((i) => i.id !== from);
		let at = without.findIndex((i) => i.id === itemId);
		if (at < 0) return;
		if (where === 'after') at += 1;
		without.splice(at, 0, moved);
		items = without;
	}

	function sentOver(e: DragEvent, itemId: number, index: number) {
		if (dragging?.kind !== 'sent' || dragging.itemId !== itemId) return;
		e.preventDefault();
		e.stopPropagation();
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		sentHint = { itemId, index, where: e.clientX < rect.left + rect.width / 2 ? 'before' : 'after' };
	}
	function sentDrop(e: DragEvent, itemId: number, index: number) {
		if (dragging?.kind !== 'sent' || dragging.itemId !== itemId) return;
		e.preventDefault();
		e.stopPropagation();
		const fromIdx = dragging.index;
		const where = sentHint?.where ?? 'before';
		endDrag();
		const item = items.find((i) => i.id === itemId);
		if (!item || fromIdx === index) return;
		const moved = item.sentences[fromIdx];
		const target = item.sentences[index];
		const without = item.sentences.filter((_, k) => k !== fromIdx);
		let at = without.indexOf(target);
		if (at < 0) at = without.length;
		if (where === 'after') at += 1;
		without.splice(at, 0, moved);
		item.sentences = without;
		item.block = without.join(' ');
	}
</script>

<aside class="reference" aria-label="LLM draft">
	<div class="reference-head">
		<span class="ref-path">{path}</span>
		<span class="mode-seg" role="group" aria-label="Chunk action">
			<button type="button" class:on={mode === 'insert'} onclick={() => (mode = 'insert')}>Insert</button>
			<button type="button" class:on={mode === 'copy'} onclick={() => (mode = 'copy')}>Copy</button>
		</span>
	</div>

	{#each items as item (item.id)}
		{#if item.prose}
			<p
				class="para"
				class:used={isUsed(item.block)}
				class:drop-before={paraHint?.id === item.id && paraHint.where === 'before'}
				class:drop-after={paraHint?.id === item.id && paraHint.where === 'after'}
				ondragover={(e) => paraOver(e, item.id)}
				ondrop={(e) => paraDrop(e, item.id)}
			>
				{#each item.sentences as sentence, j (j)}
					<button
						type="button"
						class="sent"
						class:used={isUsed(sentence)}
						class:copied={copiedKey === `${item.id}:${j}`}
						class:sdrop-before={sentHint?.itemId === item.id && sentHint.index === j && sentHint.where === 'before'}
						class:sdrop-after={sentHint?.itemId === item.id && sentHint.index === j && sentHint.where === 'after'}
						draggable="true"
						ondragstart={(e) => sentDragStart(e, item.id, j, sentence)}
						ondragover={(e) => sentOver(e, item.id, j)}
						ondrop={(e) => sentDrop(e, item.id, j)}
						ondragend={endDrag}
						onclick={() => activate(sentence, true, `${item.id}:${j}`)}
						title={mode === 'copy' ? 'Copy this sentence' : 'Insert this sentence at the cursor'}
					>{sentence}</button>
				{/each}<button
					type="button"
					class="para-insert"
					class:copied={copiedKey === `${item.id}:p`}
					draggable="true"
					ondragstart={(e) => paraDragStart(e, item.id, item.block)}
					ondragend={endDrag}
					onclick={() => activate(item.block, false, `${item.id}:p`)}
					title={mode === 'copy' ? 'Copy the paragraph' : 'Insert the whole paragraph at the cursor'}
					aria-label="Paragraph"
				>¶</button>
			</p>
		{:else}
			<button
				type="button"
				class="block"
				class:used={isUsed(item.block)}
				class:copied={copiedKey === `${item.id}:b`}
				class:drop-before={paraHint?.id === item.id && paraHint.where === 'before'}
				class:drop-after={paraHint?.id === item.id && paraHint.where === 'after'}
				draggable="true"
				ondragstart={(e) => paraDragStart(e, item.id, item.block)}
				ondragover={(e) => paraOver(e, item.id)}
				ondrop={(e) => paraDrop(e, item.id)}
				ondragend={endDrag}
				onclick={() => activate(item.block, false, `${item.id}:b`)}
				title={mode === 'copy' ? 'Copy' : 'Insert at the cursor'}
			>{item.block}</button>
		{/if}
	{/each}
</aside>

<style>
	.reference {
		display: flex;
		flex-direction: column;
		gap: 4px;
		position: sticky;
		top: 0;
		align-self: start;
		max-height: calc(100vh - 120px);
		overflow-y: auto;
		padding-right: 4px;
	}

	.reference-head {
		align-items: center;
		color: var(--ink-3);
		display: flex;
		gap: 8px;
		justify-content: space-between;
		padding: 0 10px 6px;
	}

	.ref-path {
		font-family: var(--font-mono);
		font-size: 11px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.mode-seg {
		background: var(--bg);
		border: 1px solid var(--line);
		border-radius: 7px;
		display: inline-flex;
		flex: none;
		padding: 2px;
	}

	.mode-seg button {
		background: transparent;
		border: none;
		border-radius: 5px;
		color: var(--ink-3);
		cursor: pointer;
		font: inherit;
		font-size: 11px;
		padding: 3px 9px;
	}

	.mode-seg button.on {
		background: var(--hover);
		color: var(--ink);
	}

	.para {
		position: relative;
		margin: 0;
		padding: 6px 34px 6px 8px;
		border-radius: var(--radius);
		color: var(--ink-2);
		font-family: var(--font-ui);
		font-size: 13px;
		line-height: 1.6;
	}

	.sent {
		display: inline;
		background: transparent;
		border: none;
		border-radius: 5px;
		color: inherit;
		cursor: pointer;
		font: inherit;
		margin-right: 0.28em;
		padding: 1px 3px;
		text-align: left;
		transition: transform 80ms ease, background 120ms ease, box-shadow 120ms ease;
	}

	.sent:hover {
		background: color-mix(in srgb, var(--accent) 16%, transparent);
		box-shadow: 0 2px 5px rgba(0, 0, 0, 0.18);
		color: var(--ink);
		transform: translateY(-1px);
	}

	.sent:active {
		cursor: grabbing;
	}

	.sent.used {
		color: var(--ink-3);
		opacity: 0.5;
	}

	.sent.copied,
	.para-insert.copied,
	.block.copied {
		background: color-mix(in srgb, var(--ok) 22%, transparent);
		color: var(--ink);
	}

	.sent.sdrop-before {
		box-shadow: inset 2px 0 0 var(--accent);
	}

	.sent.sdrop-after {
		box-shadow: inset -2px 0 0 var(--accent);
	}

	.para-insert {
		position: absolute;
		top: 4px;
		right: 4px;
		display: none;
		background: var(--bg);
		border: 1px solid var(--line);
		border-radius: 6px;
		color: var(--accent-ink);
		cursor: grab;
		font-size: 12px;
		line-height: 1;
		padding: 3px 6px;
	}

	.para:hover .para-insert {
		display: inline-flex;
	}

	.para:has(.para-insert:hover) {
		background: color-mix(in srgb, var(--accent) 9%, var(--bg));
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent);
	}

	.block {
		background: var(--bg);
		border: none;
		border-radius: var(--radius);
		color: var(--ink-2);
		cursor: pointer;
		font-family: var(--font-ui);
		font-size: 13px;
		line-height: 1.55;
		padding: 10px 12px;
		text-align: left;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.block:hover {
		background: color-mix(in srgb, var(--accent) 9%, var(--bg));
		color: var(--ink);
	}

	.block.used {
		color: var(--ink-3);
		opacity: 0.5;
	}

	.para.drop-before,
	.block.drop-before {
		box-shadow: inset 0 2px 0 var(--accent);
	}

	.para.drop-after,
	.block.drop-after {
		box-shadow: inset 0 -2px 0 var(--accent);
	}

	@media (max-width: 960px) {
		.reference {
			position: static;
			max-height: 40vh;
		}
	}
</style>
