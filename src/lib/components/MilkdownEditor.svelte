<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Crepe } from '@milkdown/crepe';
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
		crepe = new Crepe({ root: host, defaultValue: value });
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
</script>

<div class="milkdown-host" bind:this={host}></div>

<style>
	.milkdown-host {
		min-height: 60vh;
	}

	.milkdown-host :global(.milkdown) {
		background: transparent;
	}

	.milkdown-host :global(.ProseMirror) {
		outline: none;
		padding: 0;
	}
</style>
