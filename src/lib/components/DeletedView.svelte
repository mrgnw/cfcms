<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { PostListItem } from '$lib/types';

	let { posts }: { posts: PostListItem[] } = $props();

	let busyPath = $state<string | null>(null);
	let error = $state<string | null>(null);

	async function postAction(action: 'restore' | 'purge', path: string) {
		if (action === 'purge' && !confirm(`Permanently delete ${path}? This removes the file.`)) return;

		busyPath = path;
		error = null;
		const fd = new FormData();
		fd.set('path', path);
		try {
			const res = await fetch(`/?/${action}`, { method: 'POST', body: fd });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			await invalidateAll();
		} catch (caught) {
			error = caught instanceof Error ? caught.message : String(caught);
		} finally {
			busyPath = null;
		}
	}
</script>

<div class="deleted-view">
	<header class="view-head">
		<a class="back" href={resolve('/')} aria-label="Back to posts">‹</a>
		<h2>Deleted</h2>
		<span class="summary">{posts.length} {posts.length === 1 ? 'post' : 'posts'}</span>
	</header>

	{#if error}
		<p class="error">{error}</p>
	{/if}

	<div class="rows">
		{#each posts as post (post.path)}
			<div class="drow" class:busy={busyPath === post.path}>
				<a href={resolve(`/?post=${encodeURIComponent(post.path)}`)}>
					<strong>{post.title}</strong>
					<small>{post.date || 'undated'} · {post.path}</small>
				</a>
				<span class="actions">
					<button type="button" disabled={busyPath != null} onclick={() => postAction('restore', post.path)}>
						Restore
					</button>
					<button
						class="danger"
						type="button"
						disabled={busyPath != null}
						onclick={() => postAction('purge', post.path)}
					>
						Purge
					</button>
				</span>
			</div>
		{:else}
			<p class="empty">Nothing deleted.</p>
		{/each}
	</div>
</div>

<style>
	.deleted-view {
		max-width: 560px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding-top: 4vh;
	}

	.view-head {
		display: flex;
		align-items: baseline;
		gap: 10px;
	}

	.view-head .back {
		color: var(--ink-3);
		font-size: 18px;
		text-decoration: none;
	}

	.view-head h2 {
		font-family: var(--font-display);
		font-size: 26px;
		font-weight: 600;
		letter-spacing: -0.01em;
		margin: 0;
	}

	.summary {
		color: var(--ink-2);
		font-size: 13px;
	}

	.rows {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.drow {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 10px;
		background: var(--bg);
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 10px 12px;
	}

	.drow.busy {
		opacity: 0.5;
	}

	.drow a {
		color: inherit;
		display: grid;
		gap: 3px;
		font-size: 13px;
		text-decoration: none;
		min-width: 0;
	}

	.drow small {
		color: var(--ink-3);
		font-size: 11px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.actions {
		display: flex;
		gap: 6px;
		flex-shrink: 0;
	}

	.actions button {
		border: 1px solid var(--line);
		background: var(--paper);
		border-radius: 999px;
		font: inherit;
		font-size: 11px;
		padding: 4px 10px;
		color: var(--ink-2);
		cursor: pointer;
	}

	.actions button:hover:not(:disabled) {
		background: var(--hover);
	}

	.actions button.danger {
		color: var(--danger);
	}

	.actions button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.empty {
		color: var(--ink-3);
		font-size: 13px;
		text-align: center;
		padding: 18px;
		margin: 0;
	}

	.error {
		background: color-mix(in srgb, var(--danger) 10%, transparent);
		border-radius: var(--radius);
		color: var(--danger);
		font-size: 12px;
		margin: 0;
		padding: 8px 12px;
	}
</style>
