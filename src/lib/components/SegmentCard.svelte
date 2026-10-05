<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		kind,
		label,
		theirs = null,
		yours = null,
		strike = false,
		children
	}: {
		kind: string;
		label: string;
		theirs?: string | null;
		yours?: string | null;
		strike?: boolean;
		children?: Snippet;
	} = $props();
</script>

<div class="segment {kind}">
	<div class="seg-kind">{label}</div>
	{#if theirs != null}<div class="seg-theirs">{theirs}</div>{/if}
	{#if yours != null}<div class="seg-yours" class:strike>{yours}</div>{/if}
	{#if children}<div class="seg-acts">{@render children()}</div>{/if}
</div>

<style>
	.segment {
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: 8px;
		margin-bottom: 10px;
		padding: 9px 10px;
	}

	.segment.added { box-shadow: inset 2.5px 0 0 var(--ok); }
	.segment.modified { box-shadow: inset 2.5px 0 0 var(--accent); }
	.segment.removed { box-shadow: inset 2.5px 0 0 var(--danger); }
	.segment.conflict { box-shadow: inset 2.5px 0 0 var(--warn); }
	.segment.field { box-shadow: inset 2.5px 0 0 var(--ink-3); }

	.seg-kind {
		color: var(--ink-3);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.06em;
		margin-bottom: 5px;
		text-transform: uppercase;
	}

	.seg-theirs { font: 13px/1.5 var(--font-body, Georgia, serif); margin-bottom: 6px; white-space: pre-wrap; }
	.seg-yours { color: var(--ink-3); font-size: 11.5px; margin-bottom: 6px; white-space: pre-wrap; }
	.seg-yours.strike { text-decoration: line-through; }
	.seg-acts { display: flex; gap: 6px; }

	.seg-acts :global(button) {
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: 6px;
		color: var(--ink-2);
		cursor: pointer;
		font: 600 11px/1 inherit;
		font-family: inherit;
		padding: 4px 8px;
	}

	.seg-acts :global(button.primary) { background: var(--accent); border-color: var(--accent); color: #fff; }
</style>
