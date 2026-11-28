<script lang="ts">
	import { invalidate, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { MediaQuery } from 'svelte/reactivity';
	import { dndzone, type DndEvent } from 'svelte-dnd-action';
	import { swipeable, type SwipeEndEventDetail } from '@svelte-put/swipeable';
	import { getPosts } from '#lib/posts.remote.js';
	import { queueAdd, queueRemove, queueReorder, trash } from '#lib/queue.remote.js';
	import { shortDate } from '#lib/short-date.js';
	import StatusDot from './StatusDot.svelte';
	import { effortLabels, efforts, editingQueue, postsDependency, inStage, isEditing, statusOf, type Effort, type PostFilter, type PostListItem } from '#lib/types.js';

	let {
		posts,
		selectedPath,
		filter,
		query
	}: {
		posts: PostListItem[];
		selectedPath?: string;
		filter: PostFilter;
		query: string;
	} = $props();

	let swipedPath = $state<string | null>(null);

	const touchLayout = new MediaQuery('max-width: 720px');
	const currentYear = new Date().getFullYear();

	type QueueItem = { id: string; post: PostListItem };

	let dragItems = $state<QueueItem[] | null>(null);
	let baseQueueItems = $derived(editingQueue(posts).map((post) => ({ id: post.path, post })));
	let queueItems = $derived(dragItems ?? baseQueueItems);

	let effortFilter = $state<Effort | 'all'>('all');
	let queueSized = $derived(queueItems.some((item) => item.post.effort));
	let shownQueueItems = $derived(
		effortFilter === 'all' || !queueSized ? queueItems : queueItems.filter((item) => item.post.effort === effortFilter)
	);
	const effortCount = (effort: Effort) => queueItems.filter((item) => item.post.effort === effort).length;

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

	let filteredPosts = $derived(posts.filter((post) => inStage(post, filter) && matchesQuery(post)));

	let recentPosts = $derived(posts.filter((post) => !isEditing(post)).slice(0, 5));
	let restPosts = $derived(posts.filter((post) => !isEditing(post)).slice(5));

	const postHref = (slug: string) => resolve('/[[stage=stage]]/posts/[slug]', { stage: page.params.stage, slug });

	function trackSection(sectioned: boolean) {
		return (list: HTMLElement) => {
			if (!sectioned) return;
			const observer = new IntersectionObserver(
				(entries) => {
					for (const entry of entries) if (entry.isIntersecting) replaceState(`#${entry.target.id}`, page.state);
				},
				{ root: list, rootMargin: '0px 0px -90% 0px' }
			);
			for (const heading of list.querySelectorAll('h3[id]')) observer.observe(heading);
			return () => observer.disconnect();
		};
	}

	// a command refreshes getPosts in its own response; a failed one resyncs the list
	async function run(pending: Promise<unknown>) {
		const ok = await pending.then(() => true, () => false);
		if (!ok) await getPosts().refresh();
		return ok;
	}

	const addToQueue = (path: string) => run(queueAdd(path).updates(getPosts()));
	const removeFromQueue = (path: string) => run(queueRemove(path).updates(getPosts()));

	// trashing the open post rewrites its frontmatter, so that page's data refetches too
	async function trashPost(path: string) {
		const ok = await run(trash(path).updates(getPosts()));
		if (ok && path === selectedPath) await invalidate(postsDependency);
		return ok;
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
		if (!await trashPost(path)) {
			wrap.style.setProperty('--swipe-distance-x', '0px');
			swipedPath = null;
		}
	}

	function handleDnd(event: CustomEvent<DndEvent<QueueItem>>) {
		dragItems = event.detail.items;
	}

	async function handleDndFinalize(event: CustomEvent<DndEvent<QueueItem>>) {
		dragItems = event.detail.items;
		await run(queueReorder(event.detail.items.map((item) => item.id)).updates(getPosts()));
		dragItems = null;
	}
</script>

{#snippet rowBody(item: PostListItem)}
	{@const date = shortDate(item.date, currentYear)}
	<StatusDot status={statusOf(item)} />
	<strong>{item.title}</strong>
	<span class="date" class:missing={!date}>{date ?? 'no date'}</span>
	{#if item.effort || item.nextStep}
		<small class="next">
			{#if item.effort}<span class="effort {item.effort}">{effortLabels[item.effort]}</span>{/if}
			{item.nextStep ?? ''}
		</small>
	{/if}
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
			href={postHref(item.slug)}
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
					onclick={() => !swipedPath && addToQueue(item.path)}
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
				onclick={() => trashPost(item.path)}
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

<svelte:window onpointercancel={cancelSwipe}></svelte:window>

	<nav class="post-list" aria-label="Post list" {@attach trackSection(sectioned)}>
		{#if sectioned}
			{#if queueItems.length}
				<h3 class="section-label editing-label" id="editing">Editing</h3>
				{#if queueSized}
					<fieldset class="effort-filter">
						<legend class="sr-only">Show</legend>
						<label><input type="radio" bind:group={effortFilter} value="all" />All {queueItems.length}</label>
						{#each efforts as effort (effort)}
							<label><input type="radio" bind:group={effortFilter} value={effort} />{effortLabels[effort]} {effortCount(effort)}</label>
						{/each}
					</fieldset>
				{/if}
				<div
					class="queue"
					aria-label="Editing queue, long-press or drag to reorder"
					use:dndzone={{
						items: shownQueueItems,
						flipDurationMs: 150,
						delayTouchStart: 300,
						dropTargetStyle: {},
						dragDisabled: shownQueueItems !== queueItems
					}}
					onconsider={handleDnd}
					onfinalize={handleDndFinalize}
				>
					{#each shownQueueItems as item (item.id)}
						<div class="qrow" class:selected={item.post.path === selectedPath} aria-label={item.post.title}>
							<a class="row" href={postHref(item.post.slug)} draggable="false">
								{@render rowBody(item.post)}
							</a>
							<button
								class="remove-q"
								type="button"
								title="Remove from editing queue"
								onclick={() => removeFromQueue(item.post.path)}
							>
								×
							</button>
						</div>
					{/each}
				</div>
			{/if}
			{#if recentPosts.length}
				<h3 class="section-label" id="recent">Recent</h3>
				{#each recentPosts as item (item.path)}
					{@render postRow(item)}
				{/each}
			{/if}
			{#if restPosts.length}
				<h3 class="section-label" id="everything">Everything</h3>
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

<style>
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

	.effort-filter {
		display: flex;
		gap: 2px;
		border: none;
		margin: 0 0 2px;
		padding: 0;
	}

	.effort-filter label {
		border-radius: 7px;
		color: var(--ink-2);
		cursor: pointer;
		font-size: 12px;
		font-variant-numeric: tabular-nums;
		padding: 4px 8px;
	}

	.effort-filter label:hover,
	.effort-filter label:has(:checked) {
		background: var(--hover);
	}

	.effort-filter label:has(:checked) {
		color: var(--ink);
		font-weight: 560;
	}

	.effort-filter label:has(:focus-visible) {
		outline: 2px solid var(--accent);
	}

	.effort-filter input,
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.next {
		grid-column: 2 / -1;
		color: var(--ink-2);
		font-size: 12px;
		line-height: 1.35;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.effort {
		font-weight: 600;
		margin-right: 4px;
	}

	.effort.quick {
		color: var(--ok);
	}

	.effort.deep {
		color: var(--accent-ink);
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
		gap: 2px 9px;
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

	@media (max-width: 720px) {
		.post-list {
			overflow: visible;
		}
		.row {
			font-size: 15px;
			padding: 10px 8px;
			border-radius: 0;
			border-bottom: 1px solid var(--line);
			background: var(--bg);
		}
		.row-actions,
		.remove-q {
			display: none;
		}
		.swipe-hint {
			display: flex;
		}
		.row-wrap {
			touch-action: pan-y;
		}
	}
</style>
