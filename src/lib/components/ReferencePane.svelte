<script lang="ts">
	import { normalizeBlock, splitBlocks } from '$lib/blocks';

	type Props = {
		path: string;
		body: string;
		userBody: string;
		onCopy: (index: number) => void;
	};

	let { path, body, userBody, onCopy }: Props = $props();

	const blocks = $derived(splitBlocks(body));
	const userNorms = $derived(new Set(splitBlocks(userBody).map(normalizeBlock)));
</script>

<aside class="reference" aria-label="LLM draft">
	<div class="reference-head">{path}</div>
	{#each blocks as block, index (index)}
		{@const copied = userNorms.has(normalizeBlock(block))}
		<button
			type="button"
			class="block"
			class:copied
			disabled={copied}
			onclick={() => onCopy(index)}
			title={copied ? 'Already in your draft' : 'Copy into your draft'}
		>{block}</button>
	{/each}
</aside>

<style>
	.reference {
		display: flex;
		flex-direction: column;
		gap: 6px;
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

	.block:hover:not(:disabled) {
		background: color-mix(in srgb, var(--accent) 9%, var(--bg));
		color: var(--ink);
	}

	.block.copied {
		background: transparent;
		box-shadow: inset 0 0 0 1px var(--line);
		color: var(--ink-3);
		cursor: default;
	}

	.block.copied::before {
		content: '✓ ';
		color: var(--ok);
	}

	@media (max-width: 960px) {
		.reference {
			position: static;
			max-height: 40vh;
		}
	}
</style>
