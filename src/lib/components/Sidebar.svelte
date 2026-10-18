<script lang="ts">
	import { tick } from 'svelte';
	import { refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { MediaQuery } from 'svelte/reactivity';
	import { dndzone, type DndEvent } from 'svelte-dnd-action';
	import { swipeable, type SwipeEndEventDetail } from '@svelte-put/swipeable';
	import { shortDate } from '#lib/short-date.js';
	import StagePipeline from './StagePipeline.svelte';
	import StatusDot from './StatusDot.svelte';
	import { isEditing, isPending, statusOf, type PostCounts, type PostFilter, type PostListItem } from '#lib/types.js';

	let {
		posts,
		selectedPath,
		counts,
		open = $bindable(true),
		filter = $bindable('all')
	}: {
		posts: PostListItem[];
		selectedPath?: string;
		counts: PostCounts;
		open?: boolean;
		filter?: PostFilter;
	} = $props();

	let query = $state('');
	let swipedPath = $state<string | null>(null);

	const touchLayout = new MediaQuery('max-width: 720px');
	const currentYear = new Date().getFullYear();

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

			return [
				post.title,
				post.path,
				post.slug,
				post.excerpt,
				statusOf(post),
				...post.tags ?? []
			].filter(Boolean).join(' ').toLowerCase().includes(term);
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

	let editingLabel = $state<HTMLElement>();
	let recentLabel = $state<HTMLElement>();

	function jump(stage: PostFilter) {
		open = true;
		filter = stage;
	}

	async function jumpTo(section: 'editing' | 'recent') {
		open = true;
		filter = 'all';
		query = '';
		await tick();
		(section === 'editing' ? editingLabel : recentLabel)?.scrollIntoView({ block: 'start' });
	}

	async function postAction(action: string, fields: Record<string, string>) {
		const fd = new FormData();
		for (const [key, value] of Object.entries(fields)) fd.set(key, value);
		const res = await fetch(`/?/${action}`, { method: 'POST', body: fd });
		await refreshAll();
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
		if (!await postAction('trash', { path })) {
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

{#snippet rowBody(item: PostListItem)}
	{@const date = shortDate(item.date, currentYear)}
	<StatusDot status={statusOf(item)} />
	<strong>{item.title}</strong>
	<span class="date" class:missing={!date}>{date ?? 'no date'}</span>
{/snippet}

{#snippet postRow(item: PostListItem)}
	<div
		class="row-wrap"
		use:swipeable={{
			direction: 'left',
			threshold: '40%',
			disableTouchEvents: false,
			enabled: touchLayout.current
		}}
		onswipestart={() => swipedPath = item.path}
		onswipeend={(event) => finishSwipe(event, item.path)}
	>
		<span class="swipe-hint" aria-hidden="true">Delete</span>
		<a
			class="row"
			class:selected={item.path === selectedPath}
			href={resolve('/posts/[slug]', { slug: item.slug })}
			draggable="false"
			onclick={(event) => {
				if (swipedPath) event.preventDefault();
			}}
		>
			{@render rowBody(item)}
		</a>
		<span class="row-actions">
			{#if !isEditing(item)}
				<button
					class="add-q"
					type="button"
					title="Add to editing queue"
					aria-label="Add to editing queue"
					onclick={() => !swipedPath && postAction('queueAdd', { path: item.path })}
				>
					<svg
						width="15"
						height="15"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path d="M11 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0"></path>
						<path d="M12 7a5 5 0 1 0 5 5"></path>
						<path d="M13 3.055A9 9 0 1 0 20.941 11"></path>
						<path d="M15 6v3h3l3-3h-3V3zm0 3l-3 3"></path>
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
				<svg
					width="15"
					height="15"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.9"
					stroke-linecap="round"
					stroke-linejoin="round"
				><path d="M4 7h16M10 4h4M9 11v6M15 11v6M6 7l1 13h10l1-13"></path></svg>
			</button>
		</span>
	</div>
{/snippet}

{#snippet railItem(label: string, count: number, cls: string, d: string, onclick: () => void)}
	<button class="rail-item {cls}" type="button" title={label} aria-label="{label}, {count}" {onclick}>
		<svg
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.8"
			stroke-linecap="round"
			stroke-linejoin="round"
		><path {d}></path></svg>
		{count}
	</button>
{/snippet}

<svelte:window onpointercancel={cancelSwipe}></svelte:window>

<aside class="sidebar" class:closed={!open} aria-label="Posts">
	<header class="sidebar-head">
		<button
			class="icon-btn"
			type="button"
			onclick={() => open = !open}
			aria-label="Toggle sidebar"
			title="Toggle sidebar"
		>
			<svg
				width="16"
				height="16"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				stroke-width="1.6"
			><path d="M3 4h10M3 8h10M3 12h10" stroke-linecap="round"></path></svg>
		</button>

		<a class="new-post" href={resolve('new')}>
			<svg
				width="15"
				height="15"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				stroke-width="1.8"
			><path d="M8 3v10M3 8h10" stroke-linecap="round"></path></svg>

			New post
		</a>
	</header>

	<nav class="rail" aria-label="Jump to">
		{@render railItem('Drafts', counts.drafts, 'drafts', 'M6 3h8l4 4v14H6zM14 3v4h4', () => jump('drafts'))}
		{#if queueItems.length}
			{@render railItem('Editing', queueItems.length, 'editing', 'M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3zM13.5 6.5l3 3', () => jumpTo('editing'))}
		{/if}
		{@render railItem('Recent', recentPosts.length, 'recent', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2', () => jumpTo('recent'))}
		{@render railItem('Ready', counts.ready, 'ready', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9 12l2 2 4-4', () => jump('ready'))}
		<a class="rail-item publish" class:idle={!counts.ready} href={resolve('publish')} title="Publish" aria-label="Publish">
			<svg
				width="16"
				height="16"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2.2"
				stroke-linecap="round"
				stroke-linejoin="round"
			><path d="M5 12h14M13 6l6 6-6 6"></path></svg>
		</a>
		{@render railItem('Live', counts.live, 'live', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18', () => jump('live'))}
	</nav>

	<StagePipeline {counts} bind:filter />

	<input class="search" type="search" bind:value={query} placeholder="Search…" aria-label="Search posts" />

	<nav class="post-list" aria-label="Post list">
		{#if sectioned}
			{#if queueItems.length}
				<h3 class="section-label editing-label" bind:this={editingLabel}>Editing</h3>
				<div
					class="queue"
					aria-label="Editing queue, long-press or drag to reorder"
					use:dndzone={{ items: queueItems, flipDurationMs: 150, delayTouchStart: 300, dropTargetStyle: {} }}
					onconsider={handleDnd}
					onfinalize={handleDndFinalize}
				>
					{#each queueItems as item (item.id)}
						<div class="qrow" class:selected={item.post.path === selectedPath} aria-label={item.post.title}>
							<a class="row" href={resolve('/posts/[slug]', { slug: item.post.slug })} draggable="false">
								{@render rowBody(item.post)}
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
				<h3 class="section-label" bind:this={recentLabel}>Recent</h3>
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
		<a href={resolve('deleted')}>Deleted {counts.deleted} ›</a>
		<a href={resolve('admin')}>Admin ›</a>
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
		.sidebar.closed > :global(:not(.sidebar-head, .rail)),
		.sidebar.closed .new-post {
			display: none;
		}

		.sidebar.closed {
			padding: 14px 6px;
		}

		.sidebar.closed .rail {
			display: flex;
		}
	}

	.rail {
		display: none;
		flex-direction: column;
		align-items: center;
		gap: 2px;
	}

	.rail-item {
		display: grid;
		justify-items: center;
		gap: 1px;
		width: 32px;
		padding: 5px 0 4px;
		background: transparent;
		border: none;
		border-radius: 8px;
		color: var(--ink-2);
		cursor: pointer;
		font: inherit;
		font-size: 10px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		text-decoration: none;
	}

	.rail-item:hover {
		background: var(--hover);
		color: var(--ink);
	}

	.rail-item.editing {
		color: var(--accent-ink);
	}

	.rail-item.ready {
		color: var(--warn);
	}

	.rail-item.live {
		color: var(--ok);
	}

	.rail-item.publish {
		background: var(--accent);
		color: var(--on-accent);
		padding: 8px 0;
	}

	.rail-item.publish.idle {
		background: var(--hover);
		color: var(--ink-3);
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
		align-items: center;
		background: var(--ink);
		border-radius: 8px;
		color: var(--paper);
		display: inline-flex;
		flex: 1;
		font-size: 13px;
		gap: 6px;
		justify-content: center;
		padding: 8px 10px;
		text-decoration: none;
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
		position: relative;
		cursor: grab;
	}

	.qrow.selected .row {
		background: var(--hover);
		box-shadow: inset 2px 0 0 var(--accent);
	}

	.remove-q {
		position: absolute;
		right: 6px;
		top: 50%;
		transform: translateY(-50%);
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: 999px;
		color: var(--ink-3);
		cursor: pointer;
		font-size: 14px;
		line-height: 1;
		padding: 3px 6px;
		opacity: 0;
		transition: opacity 120ms;
	}

	.qrow:hover .remove-q,
	.remove-q:focus-visible {
		opacity: 1;
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
		grid-template-columns: 7px minmax(0, 1fr) auto;
		gap: 9px;
		align-items: baseline;
		border-radius: 8px;
		color: inherit;
		padding: 7px 8px;
		text-decoration: none;
		font-size: 13px;
		transform: translateX(var(--swipe-distance-x, 0px));
	}

	.row strong {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
		font-weight: 560;
		line-height: 1.3;
	}

	.date {
		color: var(--ink-3);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.date.missing {
		color: var(--danger);
		opacity: 0.7;
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

	.empty {
		color: var(--ink-3);
		font-size: 13px;
		text-align: center;
		padding: 14px;
	}

	.footer-links {
		display: flex;
		gap: 12px;
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

	@media (max-width: 720px) {
		/* the page scrolls, not the list, so iOS Safari can collapse its bar and nothing sits under it */
		.sidebar {
			border-right: none;
			overflow: visible;
			padding-bottom: calc(96px + env(safe-area-inset-bottom));
		}
		.post-list {
			overflow: visible;
		}
		.row {
			font-size: 15px;
			padding: 10px 8px;
			border-radius: 0;
			border-bottom: 1px solid var(--line);
		}
		.row-actions,
		.remove-q {
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
