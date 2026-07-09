<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Crepe, CrepeFeature } from '@milkdown/crepe';
	import { replaceAll } from '@milkdown/kit/utils';
	import '@milkdown/crepe/theme/common/style.css';
	import '@milkdown/crepe/theme/frame.css';

	type Props = {
		value: string;
		onChange?: (markdown: string) => void;
	};

	let { value, onChange }: Props = $props();

	let host: HTMLDivElement;
	let crepe: Crepe | null = null;

	onMount(async () => {
		crepe = new Crepe({
			root: host,
			defaultValue: value,
			featureConfigs: {
				[CrepeFeature.Placeholder]: {
					text: 'Write the post...',
					mode: 'doc'
				}
			}
		});
		crepe.on((listener) => {
			listener.markdownUpdated((_, md) => {
				onChange?.(md);
			});
		});
		await crepe.create();
	});

	onDestroy(() => {
		crepe?.destroy();
	});

	export function setContent(markdown: string) {
		crepe?.editor.action(replaceAll(markdown, true));
	}
</script>

<div class="milkdown-host" bind:this={host}></div>

<style>
	.milkdown-host {
		min-height: 60vh;
	}

	.milkdown-host :global(.milkdown) {
		--crepe-color-background: transparent;
		--crepe-color-on-background: var(--ink);
		--crepe-color-surface: var(--paper);
		--crepe-color-surface-low: var(--bg);
		--crepe-color-on-surface: var(--ink);
		--crepe-color-on-surface-variant: var(--ink-2);
		--crepe-color-outline: var(--ink-3);
		--crepe-color-primary: var(--accent);
		--crepe-color-secondary: var(--hover);
		--crepe-color-on-secondary: var(--ink);
		--crepe-color-inline-code: var(--accent-ink);
		--crepe-color-error: var(--danger);
		--crepe-color-hover: var(--hover);
		--crepe-color-selected: var(--hover);
		--crepe-color-inline-area: var(--line);
		--crepe-font-title: var(--font-display);
		--crepe-font-default: var(--font-display);
		--crepe-font-code: var(--font-mono);
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
</style>
