<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { MediaQuery } from 'svelte/reactivity';
	import { dndzone, type DndEvent } from 'svelte-dnd-action';
	import { swipeable, type SwipeEndEventDetail } from '@svelte-put/swipeable';
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
	let swipedPath = $state<string | null>(null);

	const touchLayout = new MediaQuery('max-width: 720px');

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
			if (filter === 'live' && status !== 'live') return false;
			return matchesQuery(post);
		})
	);

	let recentPosts = $derived(visiblePosts.filter((post) => !isEditing(post)).slice(0, 5));
	let restPosts = $derived(visiblePosts.filter((post) => !isEditing(post)).slice(5));

	async function postAction(action: string, fields: Record<string, string>) {
		const fd = new FormData();
		for (const [key, value] of Object.entries(fields)) fd.set(key, value);
		const res = await fetch(`?/${action}`, { method: 'POST', body: fd });
		await invalidateAll();
		return res.ok;
	}

	function cancelSwipe(event: PointerEvent) {
		swipedPath = null;
		const wrap = (event.target as HTMLElement).closest<HTMLElement>('.row-wrap');
		wrap?.style.setProperty('--swipe-distance-x', '0px');
	}

	async function finishSwipe(event: CustomEvent<SwipeEndEventDetail>, path: string) {
		const wrap = event.currentTarget as HTMLElement;

		if (!event.detail.passThreshold || event.detail.direction !== 'left') {
			swipedPath = null;
			return;
		}
		if (!(await postAction('trash', { path }))) {
			wrap.style.setProperty('--swipe-distance-x', '0px');
			swipedPath = null;
		}
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
	<div
		class="row-wrap"
		use:swipeable={{
			direction: 'left',
			threshold: '40%',
			disableTouchEvents: false,
			enabled: touchLayout.current
		}}
		onswipestart={() => (swipedPath = item.path)}
		onswipeend={(event) => finishSwipe(event, item.path)}
	>
		<span class="swipe-hint" aria-hidden="true">Delete</span>
		<a
			class="row"
			class:selected={item.path === selectedPath}
			href={resolve(`/?post=${encodeURIComponent(item.path)}`)}
			draggable="false"
			onclick={(event) => {
				if (swipedPath) event.preventDefault();
			}}
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
		<span class="row-actions" class:swiping={swipedPath === item.path}>
			{#if !isEditing(item)}
				<button
					class="add-q"
					type="button"
					title="Add to editing queue"
					aria-label="Add to editing queue"
					onclick={() => !swipedPath && postAction('queueAdd', { path: item.path })}
				>
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M11 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0" />
						<path d="M12 7a5 5 0 1 0 5 5" />
						<path d="M13 3.055A9 9 0 1 0 20.941 11" />
						<path d="M15 6v3h3l3-3h-3V3zm0 3l-3 3" />
					</svg>
				</button>
			{/if}
			<button
				class="del-q"
				type="button"
				title="Delete post"
				aria-label="Delete post"
				onclick={() => postAction('trash', { path: item.path })}
			>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
					<path d="M4 7h16M10 4h4M9 11v6M15 11v6M6 7l1 13h10l1-13" />
				</svg>
			</button>
		</span>
	</div>
{/snippet}

<svelte:window onpointercancel={cancelSwipe} />

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
		<button class:active={filter === 'live'} onclick={() => (filter = 'live')} type="button">
			Live <em>{counts.live}</em>
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
									<DeployBadge post={item.post} showEditing={false} />
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

	.swipe-hint {
		display: none;
		position: absolute;
		inset: 0;
		align-items: center;
		justify-content: flex-end;
		background: var(--danger);
		border-radius: 8px;
		color: var(--paper);
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.06em;
		padding-right: 14px;
		text-transform: uppercase;
	}

	.row {
		position: relative;
		display: grid;
		gap: 3px;
		border-radius: 8px;
		color: inherit;
		padding: 8px 10px;
		text-decoration: none;
		font-size: 13px;
		transform: translateX(var(--swipe-distance-x, 0px));
	}

	.row:hover {
		background: var(--hover);
	}

	.row.selected {
		background: var(--hover);
		box-shadow: inset 2px 0 0 var(--accent);
	}

	.row-actions {
		position: absolute;
		right: 8px;
		top: 50%;
		transform: translate(var(--swipe-distance-x, 0px), -50%);
		display: flex;
		gap: 4px;
		opacity: 0;
		transition: opacity 120ms;
	}

	.row-actions button {
		border: 1px solid var(--line);
		background: var(--paper);
		border-radius: 999px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 5px;
		cursor: pointer;
	}

	.add-q {
		color: var(--accent-ink);
	}

	.del-q {
		color: var(--ink-3);
	}

	.del-q:hover {
		color: var(--danger);
		border-color: var(--danger);
	}

	.row-wrap:hover .row-actions,
	.row-actions:focus-within {
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
		.row-actions {
			opacity: 1;
		}
		.row-actions.swiping {
			opacity: 0;
		}
		.row-actions .del-q {
			display: none;
		}
		.swipe-hint {
			display: flex;
		}
		.row {
			background: var(--bg);
		}
		.row-wrap {
			touch-action: pan-y;
		}
	}
</style>
