<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { dndzone, type DndEvent } from 'svelte-dnd-action';
	import DeployBadge from './DeployBadge.svelte';
	import { isEditing, isPending, statusOf, type PostCounts, type PostFilter, type PostListItem } from '$lib/types';

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
		counts: PostCounts;
		open?: boolean;
		newTitle?: string;
		filter?: PostFilter;
	} = $props();

	let query = $state('');

	let visiblePosts = $derived(posts.filter((post) => !post.deleteRequested));

	type QueueItem = { id: string; post: PostListItem };

	let dragItems = $state<QueueItem[] | null>(null);
	let baseQueueItems = $derived(
		visiblePosts
			.filter(isEditing)
			.sort((a, b) => (a.editingOrder ?? 0) - (b.editingOrder ?? 0))
			.map((post) => ({ id: post.path, post }))
	);
	let queueItems = $derived(dragItems ?? baseQueueItems);

	let matchesQuery = $derived.by(() => {
		const term = query.trim().toLowerCase();
		return (post: PostListItem) => {
			if (!term) return true;
			return [post.title, post.path, post.slug, post.excerpt, statusOf(post), ...(post.tags ?? [])]
				.filter(Boolean)
				.join(' ')
				.toLowerCase()
				.includes(term);
		};
	});

	let sectioned = $derived(filter === 'all' && !query.trim());

	let filteredPosts = $derived(
		visiblePosts.filter((post) => {
			const status = statusOf(post);
			if (filter === 'ready' && !isPending(status)) return false;
			if (filter === 'drafts' && status !== 'draft') return false;
			if (filter === 'editing' && !isEditing(post)) return false;
			return matchesQuery(post);
		})
	);

	let recentPosts = $derived(visiblePosts.filter((post) => !isEditing(post)).slice(0, 5));
	let restPosts = $derived(visiblePosts.filter((post) => !isEditing(post)).slice(5));

	async function postAction(action: string, fields: Record<string, string>) {
		const fd = new FormData();
		for (const [key, value] of Object.entries(fields)) fd.set(key, value);
		await fetch(`?/${action}`, { method: 'POST', body: fd });
		await invalidateAll();
	}

	function handleDnd(event: CustomEvent<DndEvent<QueueItem>>) {
		dragItems = event.detail.items;
	}

	async function handleDndFinalize(event: CustomEvent<DndEvent<QueueItem>>) {
		dragItems = event.detail.items;
		await postAction('queueReorder', { paths: JSON.stringify(event.detail.items.map((item) => item.id)) });
		dragItems = null;
	}
</script>

{#snippet postRow(item: PostListItem)}
	<div class="row-wrap">
		<a
			class="row"
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
		{#if !isEditing(item)}
			<button class="add-q" type="button" onclick={() => postAction('queueAdd', { path: item.path })}>
				+ Edit
			</button>
		{/if}
	</div>
{/snippet}

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
		<button class:active={filter === 'editing'} onclick={() => (filter = 'editing')} type="button">
			Editing <em>{counts.editing}</em>
		</button>
		<button class:active={filter === 'drafts'} onclick={() => (filter = 'drafts')} type="button">
			Drafts <em>{counts.drafts}</em>
		</button>
		<button class:active={filter === 'ready'} onclick={() => (filter = 'ready')} type="button">
			Ready <em>{counts.ready}</em>
		</button>
	</div>

	<input class="search" type="search" bind:value={query} placeholder="Search…" aria-label="Search posts" />

	<nav class="post-list" aria-label="Post list">
		{#if sectioned}
			{#if queueItems.length}
				<h3 class="section-label editing-label">Editing</h3>
				<div
					class="queue"
					use:dndzone={{ items: queueItems, flipDurationMs: 150 }}
					onconsider={handleDnd}
					onfinalize={handleDndFinalize}
				>
					{#each queueItems as item (item.id)}
						<div class="qrow" class:selected={item.post.path === selectedPath}>
							<span class="grip" aria-hidden="true">⋮⋮</span>
							<a href={resolve(`/?post=${encodeURIComponent(item.post.path)}`)}>
								<strong>{item.post.title}</strong>
								<span class="post-meta">
									<DeployBadge post={item.post} />
									<span>{item.post.date || 'undated'}</span>
								</span>
							</a>
							<button
								class="remove-q"
								type="button"
								title="Remove from editing queue"
								onclick={() => postAction('queueRemove', { path: item.post.path })}
							>
								×
							</button>
						</div>
					{/each}
				</div>
			{/if}
			{#if recentPosts.length}
				<h3 class="section-label">Recent</h3>
				{#each recentPosts as item (item.path)}
					{@render postRow(item)}
				{/each}
			{/if}
			{#if restPosts.length}
				<h3 class="section-label">Everything</h3>
				{#each restPosts as item (item.path)}
					{@render postRow(item)}
				{/each}
			{/if}
		{:else}
			{#each filteredPosts as item (item.path)}
				{@render postRow(item)}
			{:else}
				<p class="empty">No posts match — try fewer letters.</p>
			{/each}
		{/if}
	</nav>

	<footer class="footer-links">
		<a href={resolve('/?view=deleted')}>Deleted {counts.deleted} ›</a>
		<a class="publish-link" href={resolve('/?view=publish')}>Publish {counts.ready} ›</a>
	</footer>
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
		padding: 6px 4px;
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

	.section-label {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--ink-3);
		font-size: 10.5px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		margin: 8px 2px 2px;
	}

	.section-label::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--line);
	}

	.editing-label {
		color: var(--accent-ink);
	}

	.queue {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.qrow {
		display: grid;
		grid-template-columns: 14px minmax(0, 1fr) 20px;
		gap: 8px;
		align-items: center;
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 8px 6px;
		cursor: grab;
	}

	.qrow.selected {
		box-shadow: inset 2px 0 0 var(--accent);
	}

	.qrow .grip {
		color: var(--ink-3);
		font-size: 13px;
		letter-spacing: -1px;
		text-align: center;
	}

	.qrow a {
		display: grid;
		gap: 3px;
		color: inherit;
		text-decoration: none;
		font-size: 13px;
		min-width: 0;
	}

	.remove-q {
		background: transparent;
		border: none;
		border-radius: 6px;
		color: var(--ink-3);
		cursor: pointer;
		font-size: 14px;
		line-height: 1;
		padding: 3px;
	}

	.remove-q:hover {
		background: var(--hover);
		color: var(--danger);
	}

	.row-wrap {
		position: relative;
	}

	.row {
		display: grid;
		gap: 3px;
		border-radius: 8px;
		color: inherit;
		padding: 8px 10px;
		text-decoration: none;
		font-size: 13px;
	}

	.row:hover {
		background: var(--hover);
	}

	.row.selected {
		background: var(--hover);
		box-shadow: inset 2px 0 0 var(--accent);
	}

	.add-q {
		position: absolute;
		right: 8px;
		top: 50%;
		transform: translateY(-50%);
		border: 1px solid var(--line);
		background: var(--paper);
		color: var(--accent-ink);
		border-radius: 999px;
		font-size: 11px;
		padding: 3px 9px;
		cursor: pointer;
		opacity: 0;
		transition: opacity 120ms;
	}

	.row-wrap:hover .add-q,
	.add-q:focus-visible {
		opacity: 1;
	}

	.post-meta,
	.row small,
	.qrow small {
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

	.footer-links {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 11.5px;
		padding: 0 2px;
	}

	.footer-links a {
		color: var(--ink-3);
		text-decoration: none;
	}

	.footer-links a:hover {
		color: var(--ink-2);
	}

	.footer-links a.publish-link {
		color: var(--accent-ink);
		font-weight: 600;
		font-size: 12px;
		border: 1px solid var(--line);
		background: var(--paper);
		border-radius: 999px;
		padding: 5px 12px;
	}

	.footer-links a.publish-link:hover {
		border-color: var(--accent);
	}

	@media (max-width: 720px) {
		.sidebar {
			border-right: none;
		}
		.add-q {
			opacity: 1;
		}
	}
</style>
