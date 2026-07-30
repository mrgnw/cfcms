<script lang="ts">
	import { resolve } from '$app/paths';
	import DeployBadge from './DeployBadge.svelte';
	import { isPending, statusOf, type PostFilter, type PostListItem, type PublishData } from '$lib/types';

	let {
		posts,
		selectedPath,
		counts,
		open = $bindable(true),
		newTitle = $bindable(''),
		filter = $bindable('all')
	}: {
		posts: PostListItem[];
		selectedPath?: string;
		counts: { all: number; drafts: number; ready: number; edit: number };
		open?: boolean;
		newTitle?: string;
		filter?: PostFilter;
	} = $props();

	let query = $state('');

	let filteredPosts = $derived.by(() => {
		const term = query.trim().toLowerCase();
		return posts.filter((post) => {
			const status = statusOf(post);
			if (filter === 'ready' && !isPending(status)) return false;
			if (filter === 'drafts' && status !== 'draft') return false;
			if (filter === 'edit' && !post.editRequested) return false;
			if (!term) return true;
			return [post.title, post.path, post.slug, post.excerpt, status, ...(post.tags ?? [])]
				.filter(Boolean)
				.join(' ')
				.toLowerCase()
				.includes(term);
		});
	});

	let publishResult = $state<PublishData | null>(null);
	let publishError = $state<string | null>(null);
	let publishing = $state(false);

	async function runPublish() {
		publishing = true;
		publishError = null;
		publishResult = null;
		try {
			const res = await fetch('/publish', { method: 'POST' });
			const result = await res.json();
			if (!res.ok) {
				if (Array.isArray(result.results)) publishResult = result;
				throw new Error(result.message ?? 'Publish failed');
			}
			publishResult = result;
		} catch (err) {
			publishError = err instanceof Error ? err.message : String(err);
		} finally {
			publishing = false;
		}
	}

	function outputLinks(output: string) {
		return Array.from(
			new Set(
				output.match(/https:\/\/[^\s)]+\.workers\.dev[^\s)]*|https:\/\/[^\s)]+\.pages\.dev[^\s)]*/g) ?? []
			)
		);
	}
</script>

<aside class="sidebar" class:closed={!open} aria-label="Posts">
	<header class="sidebar-head">
		<button
			class="icon-btn"
			type="button"
			onclick={() => (open = !open)}
			aria-label="Toggle sidebar"
			title="Toggle sidebar"
		>
			<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6">
				<path d="M3 4h10M3 8h10M3 12h10" stroke-linecap="round" />
			</svg>
		</button>
		<form class="new-post" method="POST" action="?/create">
			<input name="title" bind:value={newTitle} placeholder="New post title..." autocomplete="off" />
			<button disabled={!newTitle.trim()} aria-label="Create post" title="Create post">
				<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8">
					<path d="M8 3v10M3 8h10" stroke-linecap="round" />
				</svg>
			</button>
		</form>
	</header>

	<div class="filters" aria-label="Filters">
		<button class:active={filter === 'all'} onclick={() => (filter = 'all')} type="button">
			All <em>{counts.all}</em>
		</button>
		<button class:active={filter === 'drafts'} onclick={() => (filter = 'drafts')} type="button">
			Drafts <em>{counts.drafts}</em>
		</button>
		<button class:active={filter === 'ready'} onclick={() => (filter = 'ready')} type="button">
			Ready <em>{counts.ready}</em>
		</button>
		<button class:active={filter === 'edit'} onclick={() => (filter = 'edit')} type="button">
			Edit <em>{counts.edit}</em>
		</button>
	</div>

	<input class="search" type="search" bind:value={query} placeholder="Search…" aria-label="Search posts" />

	<nav class="post-list" aria-label="Post list">
		{#each filteredPosts as item (item.path)}
			<a
				class:selected={item.path === selectedPath}
				href={resolve(`/?post=${encodeURIComponent(item.path)}`)}
			>
				<strong>{item.title}</strong>
				<span class="post-meta">
					<DeployBadge post={item} />
					<span>{item.date || 'undated'}</span>
					{#if item.pin}<span>pinned</span>{/if}
				</span>
				{#if item.tags?.length}
					<small>{item.tags.join(' · ')}</small>
				{/if}
			</a>
		{:else}
			<p class="empty">No posts match — try fewer letters.</p>
		{/each}
	</nav>

	<button class="publish-btn" type="button" onclick={runPublish} disabled={publishing || !counts.ready}>
		{publishing ? 'Publishing…' : counts.ready ? `Publish ${counts.ready}` : 'Publish'}
	</button>

	{#if publishResult}
		<section class="publish-result" class:ok={publishResult.ok}>
			<h3>{publishResult.ok ? 'Published' : 'Publish errored'}</h3>
			<p>
				{publishResult.readyCount} pending · {publishResult.liveCount} live · {new Date(
					publishResult.runAt
				).toLocaleTimeString()}
			</p>
			{#each publishResult.results as r (r.name)}
				<details open={!r.ok}>
					<summary>
						<span>{r.name}</span>
						<em>{r.ok ? 'ok' : 'failed'}</em>
					</summary>
					{#if outputLinks(r.output).length}
						<div class="links">
							{#each outputLinks(r.output) as link (link)}
								<a href={link} target="_blank" rel="noreferrer">{link}</a>
							{/each}
						</div>
					{/if}
				</details>
			{/each}
		</section>
	{:else if publishError}
		<p class="error">{publishError}</p>
	{/if}
</aside>

<style>
	.sidebar {
		background: var(--bg);
		border-right: 1px solid var(--line);
		padding: 14px;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		gap: 14px;
		min-width: 0;
	}

	@media (min-width: 721px) {
		.sidebar.closed > :not(.sidebar-head),
		.sidebar.closed .new-post {
			display: none;
		}

		.sidebar.closed {
			padding: 14px 6px;
		}
	}

	.sidebar-head {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.icon-btn {
		background: transparent;
		border: none;
		border-radius: 8px;
		color: var(--ink-2);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 6px;
	}

	.icon-btn:hover {
		background: var(--hover);
	}

	.new-post {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 34px;
		gap: 6px;
		flex: 1;
	}

	.new-post input {
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 8px 10px;
		background: var(--paper);
		font: inherit;
		font-size: 13px;
		min-width: 0;
	}

	.new-post button {
		background: var(--ink);
		color: var(--paper);
		border: none;
		border-radius: 8px;
		cursor: pointer;
		display: inline-grid;
		place-items: center;
	}

	.new-post button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.filters {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 4px;
	}

	.filters button {
		background: transparent;
		border: none;
		border-radius: 7px;
		color: var(--ink-2);
		cursor: pointer;
		font: inherit;
		font-size: 12px;
		padding: 6px 9px;
		display: inline-flex;
		gap: 5px;
		align-items: center;
		justify-content: center;
	}

	.filters button em {
		font-style: normal;
		color: var(--ink-3);
		font-size: 11px;
	}

	.filters button.active {
		background: var(--hover);
		color: var(--ink);
	}

	.filters button:hover:not(.active) {
		background: var(--hover);
	}

	.publish-btn {
		background: var(--accent);
		border: none;
		border-radius: var(--radius);
		color: #fff;
		cursor: pointer;
		font: inherit;
		font-size: 13px;
		font-weight: 600;
		padding: 10px;
	}

	.publish-btn:hover:not(:disabled) {
		background: var(--accent-ink);
	}

	.publish-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.search {
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 8px 10px;
		font: inherit;
		font-size: 13px;
		background: var(--paper);
	}

	.post-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
		overflow-y: auto;
		flex: 1;
		min-height: 0;
	}

	.post-list a {
		display: grid;
		gap: 3px;
		border-radius: 8px;
		color: inherit;
		padding: 8px 10px;
		text-decoration: none;
		font-size: 13px;
	}

	.post-list a:hover {
		background: var(--hover);
	}

	.post-list a.selected {
		background: var(--hover);
		box-shadow: inset 2px 0 0 var(--accent);
	}

	.post-meta,
	.post-list small {
		color: var(--ink-3);
		font-size: 11px;
	}

	.post-meta {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}

	.empty {
		color: var(--ink-3);
		font-size: 13px;
		text-align: center;
		padding: 14px;
	}

	.publish-result {
		border-left: 3px solid var(--danger);
		display: grid;
		gap: 8px;
		padding-left: 10px;
		font-size: 12px;
	}

	.publish-result.ok {
		border-color: var(--ok);
	}

	.publish-result h3 {
		margin: 0;
		font-size: 13px;
	}

	.publish-result details {
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 6px 8px;
	}

	.publish-result summary {
		cursor: pointer;
		display: flex;
		justify-content: space-between;
		font-size: 12px;
	}

	.publish-result summary em {
		font-style: normal;
		color: var(--danger);
	}

	.publish-result.ok summary em {
		color: var(--ok);
	}

	.links {
		display: grid;
		gap: 4px;
		margin-top: 6px;
	}

	.links a {
		color: var(--accent-ink);
		font-size: 11px;
		word-break: break-all;
	}

	.error {
		background: color-mix(in srgb, var(--danger) 10%, transparent);
		border-radius: var(--radius);
		color: var(--danger);
		font-size: 12px;
		margin: 0;
		padding: 8px 12px;
	}

	@media (max-width: 720px) {
		.sidebar {
			border-right: none;
		}
	}
</style>
