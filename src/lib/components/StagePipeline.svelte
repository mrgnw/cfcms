<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { PostCounts, Stage } from '#lib/types.js';
	import { getUiState, rememberSidebar } from '#lib/ui-state.js';

	let { counts }: { counts: PostCounts } = $props();

	const ui = getUiState();

	function openSidebar() {
		ui.sidebarOpen = true;
		rememberSidebar(true);
	}
</script>

{#snippet stage(name: Stage, label: string, count: number)}
	{@const active = page.params.stage === name}
	<a
		class="stage {name}"
		class:active
		aria-current={active ? 'page' : undefined}
		href={resolve('/[[stage=stage]]', { stage: active ? undefined : name })}
		onclick={openSidebar}
	><b>{count}</b>{label}</a>
{/snippet}

<div class="pipeline" aria-label="Filter by stage">
	{@render stage('drafts', 'Drafts', counts.drafts)}
	<span class="step" aria-hidden="true">›</span>
	{@render stage('ready', 'Ready', counts.ready)}
	<a class="publish" class:idle={!counts.ready} href={resolve('publish')}>
		<svg
			width="15"
			height="15"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2.2"
			stroke-linecap="round"
			stroke-linejoin="round"
		><path d="M5 12h14M13 6l6 6-6 6"></path></svg>
		Publish
	</a>
	{@render stage('live', 'Live', counts.live)}
</div>

<style>
	.pipeline {
		display: flex;
		align-items: stretch;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--paper);
		overflow: hidden;
		flex: none;
	}

	.stage {
		flex: 1;
		min-width: 0;
		background: transparent;
		border: none;
		color: var(--ink-2);
		cursor: pointer;
		font: inherit;
		font-size: 11.5px;
		line-height: 1.2;
		padding: 6px 0 5px;
		text-align: center;
		text-decoration: none;
	}

	.stage b {
		display: block;
		color: var(--ink);
		font-size: 16px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.stage.ready b {
		color: var(--warn);
	}

	.stage.live b {
		color: var(--ok);
	}

	.stage:hover,
	.stage.active {
		background: var(--hover);
	}

	.stage.active {
		box-shadow: inset 0 -2px 0 var(--accent);
	}

	.step {
		display: grid;
		place-items: center;
		width: 12px;
		color: var(--ink-3);
		font-size: 12px;
	}

	.publish {
		display: grid;
		place-items: center;
		align-content: center;
		gap: 1px;
		padding: 0 9px;
		background: var(--accent);
		color: var(--on-accent);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.03em;
		text-decoration: none;
		text-transform: uppercase;
	}

	.publish.idle {
		background: var(--hover);
		color: var(--ink-3);
	}
</style>
