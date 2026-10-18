<script lang="ts">
	import { onDestroy } from 'svelte';
	import { browser } from '$app/env';
	import { refreshAll } from '$app/navigation';
	import { page } from '$app/state';
	import { startPoll } from '#lib/poll.js';
	import { startLagRecorder } from '#lib/lag-recorder.js';
	import Sidebar from '#lib/components/Sidebar.svelte';
	import { countPosts } from '#lib/types.js';
	import { setUiState, type UiState } from '#lib/ui-state.js';

	let { data, children } = $props();

	// svelte-ignore state_referenced_locally
	const ui: UiState = $state({ sidebarOpen: data.sidebarOpen, filter: 'all' });
	setUiState(ui);

	let counts = $derived(countPosts(data.posts));

	if (browser) {
		onDestroy(
			startPoll(async () => {
				const res = await fetch('/api/posts').catch(() => null);
				if (!res?.ok) return;
				const latest = await res.json() as { rev: string };
				if (latest.rev !== data.postsRev) refreshAll();
			}, 5000)
		);
		onDestroy(startLagRecorder());
	}
</script>

<main class="shell" class:sidebar-closed={!ui.sidebarOpen} class:has-post={page.route.id !== '/'}>
	<Sidebar
		posts={data.posts}
		selectedPath={page.data.post?.path ?? page.state.createdPath}
		counts={counts}
		bind:open={ui.sidebarOpen}
		bind:filter={ui.filter}
	/>

	<section class="workbench" aria-label="Editor">
		{@render children()}
	</section>
</main>

<style>
	:global(:root) {
		color-scheme: light;
		--paper: #ffffff;
		--bg: #f5f4f1;
		--ink: #1a1c20;
		--ink-2: #585c64;
		--ink-3: #9a9ea6;
		--line: #e4e3de;
		--hover: #edece7;
		--accent: #3b6fd4;
		--accent-ink: #2d57ac;
		--on-accent: #ffffff;
		--ok: #2f7d4f;
		--warn: #8a6512;
		--danger: #c33c33;
		--shadow: rgba(0, 0, 0, 0.18);
		--radius: 10px;
		--font-display: 'Iowan Old Style', Palatino, Georgia, serif;
		--font-ui: ui-sans-serif, system-ui, -apple-system, sans-serif;
		--font-mono: ui-monospace, 'SF Mono', Menlo, monospace;
	}

	@media (prefers-color-scheme: dark) {
		:global(:root) {
			color-scheme: dark;
			--paper: #16191f;
			--bg: #0f1115;
			--ink: #e4e7ec;
			--ink-2: #9aa4b2;
			--ink-3: #6a7484;
			--line: #262b34;
			--hover: #1f242c;
			--accent: #6b9bf0;
			--accent-ink: #93b6f7;
			--on-accent: #0f1115;
			--ok: #5fbd80;
			--warn: #d9b455;
			--danger: #ef7f74;
			--shadow: rgba(0, 0, 0, 0.5);
		}
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

	.shell {
		display: grid;
		grid-template-columns: minmax(260px, 320px) 1fr;
		height: 100vh;
		transition: grid-template-columns 200ms ease;
	}

	.shell.sidebar-closed {
		grid-template-columns: 44px 1fr;
	}

	.workbench {
		background: var(--paper);
		min-width: 0;
		padding: 28px 40px;
		overflow-y: auto;
	}

	@media (max-width: 720px) {
		.shell,
		.shell.sidebar-closed {
			grid-template-columns: 1fr;
			height: 100vh;
		}
		/* master–detail: show the list OR the editor, never stacked */
		.shell:not(.has-post) .workbench {
			display: none;
		}
		.shell:not(.has-post) {
			height: auto;
		}
		.shell.has-post :global(.sidebar) {
			display: none;
		}
		.workbench {
			padding: 16px;
		}
	}
</style>
