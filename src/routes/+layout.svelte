<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}

<style>
	:global(:root) {
		--paper: #fdfbf6;
		--bg: #f3efe6;
		--ink: #262019;
		--ink-2: #6b6254;
		--ink-3: #a19682;
		--line: #e6ded0;
		--hover: #ece5d7;
		--accent: #c05b2e;
		--accent-ink: #9c4415;
		--ok: #3c7a44;
		--warn: #8a6a14;
		--danger: #a43b2f;
		--radius: 10px;
		--font-display: 'Iowan Old Style', Palatino, Georgia, serif;
		--font-ui: ui-sans-serif, system-ui, -apple-system, sans-serif;
		--font-mono: ui-monospace, 'SF Mono', Menlo, monospace;
	}

	:global(body) {
		margin: 0;
		background: var(--bg);
		color: var(--ink);
		font-family: var(--font-ui);
		accent-color: var(--accent);
	}

	:global(*) {
		box-sizing: border-box;
	}

	:global(:is(a, button, summary):focus-visible) {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	@media (prefers-reduced-motion: reduce) {
		:global(*) {
			animation: none !important;
			transition: none !important;
		}
	}
</style>
