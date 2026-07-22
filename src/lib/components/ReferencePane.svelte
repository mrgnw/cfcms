<script lang="ts">
	import { isProse, normalizeBlock, splitBlocks, splitSentences } from '$lib/blocks';

	type Props = {
		path: string;
		body: string;
		userBody: string;
		onInsert: (markdown: string, inline: boolean) => void;
	};

	let { path, body, userBody, onInsert }: Props = $props();

	const blocks = $derived(splitBlocks(body));
	const usedNorm = $derived(normalizeBlock(userBody));
	const isUsed = (text: string) => {
		const norm = normalizeBlock(text);
		return norm.length > 0 && usedNorm.includes(norm);
	};
</script>

<aside class="reference" aria-label="LLM draft">
	<div class="reference-head">{path}</div>
	{#each blocks as block, index (index)}
		{#if isProse(block)}
			<p class="para" class:used={isUsed(block)}>
				{#each splitSentences(block) as sentence, s (s)}
					<button
						type="button"
						class="sent"
						class:used={isUsed(sentence)}
						onclick={() => onInsert(sentence, true)}
						title="Insert this sentence at the cursor"
					>{sentence}</button>{' '}
				{/each}<button
					type="button"
					class="para-insert"
					onclick={() => onInsert(block, false)}
					title="Insert the whole paragraph at the cursor"
					aria-label="Insert paragraph"
				>¶</button>
			</p>
		{:else}
			<button
				type="button"
				class="block"
				class:used={isUsed(block)}
				onclick={() => onInsert(block, false)}
				title="Insert at the cursor"
			>{block}</button>
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
		color: var(--ink-3);
		font-family: var(--font-mono);
		font-size: 11px;
		padding: 0 10px 4px;
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
		background: transparent;
		border: none;
		border-radius: 5px;
		color: inherit;
		cursor: pointer;
		font: inherit;
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

	.sent.used {
		color: var(--ink-3);
		opacity: 0.5;
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
		cursor: pointer;
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

	@media (max-width: 960px) {
		.reference {
			position: static;
			max-height: 40vh;
		}
	}
</style>
