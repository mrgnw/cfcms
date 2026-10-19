<script lang="ts">
	import { goto, refreshAll, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { MediaQuery } from 'svelte/reactivity';
	import { dndzone, type DndEvent } from 'svelte-dnd-action';
	import { swipeable, type SwipeEndEventDetail } from '@svelte-put/swipeable';
	import { shortDate } from '#lib/short-date.js';
	import StagePipeline from './StagePipeline.svelte';
	import StatusDot from './StatusDot.svelte';
	import { glyphs, type Glyph } from '#lib/glyphs.js';
	import { isEditing, isPending, isStage, statusOf, type PostCounts, type PostFilter, type PostListItem, type Stage } from '#lib/types.js';

	let {
		posts,
		selectedPath,
		counts,
		open = $bindable(true)
	}: {
		posts: PostListItem[];
		selectedPath?: string;
		counts: PostCounts;
		open?: boolean;
	} = $props();

	let query = $state('');
	let filter = $derived<PostFilter>(page.params.stage ?? 'all');
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

	function inStage(post: PostListItem, stage: PostFilter) {
		const status = statusOf(post);
		if (stage === 'ready') return isPending(status);
		if (stage === 'drafts') return status === 'draft';
		if (stage === 'live') return status === 'live';
		return true;
	}

	let filteredPosts = $derived(visiblePosts.filter((post) => inStage(post, filter) && matchesQuery(post)));

	let recentPosts = $derived(visiblePosts.filter((post) => !isEditing(post)).slice(0, 5));
	let restPosts = $derived(visiblePosts.filter((post) => !isEditing(post)).slice(5));

	type Section = 'drafts' | 'editing' | 'recent' | 'ready' | 'live';

	let sectionPosts = $derived<Record<Section, PostListItem[]>>({
		drafts: visiblePosts.filter((post) => inStage(post, 'drafts')),
		editing: queueItems.map((item) => item.post),
		recent: recentPosts,
		ready: visiblePosts.filter((post) => inStage(post, 'ready')),
		live: visiblePosts.filter((post) => inStage(post, 'live'))
	});

	let selectedSection = $derived.by((): Section | null => {
		const post = visiblePosts.find((item) => item.path === selectedPath);
		if (!post) return null;
		if (isEditing(post)) return 'editing';
		return inStage(post, 'ready') ? 'ready' : inStage(post, 'live') ? 'live' : 'drafts';
	});

	const stages: Section[] = ['drafts', 'editing', 'recent', 'ready', 'live'];

	const keyToSection: Record<string, Section> = { 1: 'drafts', 2: 'editing', 3: 'recent', 4: 'ready', 6: 'live' };

	const postHref = (slug: string) => resolve('/[[stage=stage]]/posts/[slug]', { stage: page.params.stage, slug });

	function stageHref(stage: Stage | undefined, hash = '') {
		const underStage = page.route.id?.startsWith('/[[stage=stage]]');
		const rest = underStage ? page.url.pathname.replace(/^\/(drafts|ready|live)(?=\/|$)/, '') : '';
		const path = (stage ? `/${stage}` : '') + rest;
		return (path || '/') + hash;
	}

	const sectionHref = (section: Section) => isStage(section) ? stageHref(section) : stageHref(undefined, `#${section}`);

	function leaveRail() {
		setOpen(true);
		query = '';
	}

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

	function setOpen(value: boolean) {
		open = value;
		for (const pop of document.querySelectorAll<HTMLElement>('.rail-pop:popover-open')) pop.hidePopover();
		document.cookie = `sidebar=${value ? 'open' : 'closed'}; path=/; max-age=31536000; SameSite=Lax`;
	}

	function handleShortcut(event: KeyboardEvent) {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
		if (event.key === '[') setOpen(!open);
		else if (event.key === '5') goto(resolve('publish'));
		else if (event.key in keyToSection) {
			leaveRail();
			goto(sectionHref(keyToSection[event.key]));
		}
		else return;
		event.preventDefault();
	}

	function showPop(event: PointerEvent | FocusEvent) {
		(event.currentTarget as HTMLElement).querySelector<HTMLElement>('[popover]')?.showPopover();
	}

	function hidePop(event: PointerEvent | FocusEvent) {
		(event.currentTarget as HTMLElement).querySelector<HTMLElement>('[popover]')?.hidePopover();
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

{#snippet glyph(name: Glyph)}
	<svg
		width="16"
		height="16"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
	><path d={glyphs[name]}></path></svg>
{/snippet}

{#snippet railItem(section: Section)}
	{@const items = sectionPosts[section]}
	<div
		class="rail-group"
		role="presentation"
		onpointerenter={showPop}
		onpointerleave={hidePop}
		onfocusin={showPop}
		onfocusout={hidePop}
	>
		<a
			class="rail-item {section}"
			class:current={selectedSection === section}
			style:anchor-name="--rail-{section}"
			title="{section} ({items.length})"
			aria-label="{section}, {items.length}"
			href={sectionHref(section)}
		>
			{@render glyph(section)}
			{items.length}
		</a>
		<div class="rail-pop" popover="manual" style:position-anchor="--rail-{section}">
			<h4>{section}</h4>
			{#each items.slice(0, 8) as item (item.path)}
				<a href={postHref(item.slug)} class:selected={item.path === selectedPath}>
					<StatusDot status={statusOf(item)} />
					<span>{item.title}</span>
				</a>
			{:else}
				<p>Nothing here</p>
			{/each}
			{#if items.length > 8}
				<a class="more" href={sectionHref(section)}>+{items.length - 8} more</a>
			{/if}
		</div>
	</div>
{/snippet}

<svelte:window onpointercancel={cancelSwipe} onkeydown={handleShortcut}></svelte:window>

<aside class="sidebar" class:closed={!open} aria-label="Posts">
	<header class="sidebar-head">
		<button
			class="icon-btn"
			type="button"
			onclick={() => setOpen(!open)}
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

	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
	<nav class="rail" aria-label="Jump to" onclick={leaveRail}>
		<a class="rail-item new" href={resolve('new')} title="New post" aria-label="New post">
			{@render glyph('plus')}
		</a>
		{#each stages as section (section)}
			{#if section !== 'editing' || queueItems.length}
				{@render railItem(section)}
			{/if}
			{#if section === 'ready'}
				<a class="rail-item publish" class:idle={!counts.ready} href={resolve('publish')} title="Publish" aria-label="Publish">
					{@render glyph('publish')}
				</a>
			{/if}
		{/each}

		<a class="rail-item tail" href={resolve('deleted')} title="Deleted ({counts.deleted})" aria-label="Deleted, {counts.deleted}">
			{@render glyph('trash')}
			{counts.deleted}
		</a>
		<a class="rail-item" href={resolve('admin')} title="Admin" aria-label="Admin">
			{@render glyph('gear')}
		</a>
	</nav>

	<StagePipeline {counts} />

	<input class="search" type="search" bind:value={query} placeholder="Search…" aria-label="Search posts" />

	<nav class="post-list" aria-label="Post list" {@attach trackSection(sectioned)}>
		{#if sectioned}
			{#if queueItems.length}
				<h3 class="section-label editing-label" id="editing">Editing</h3>
				<div
					class="queue"
					aria-label="Editing queue, long-press or drag to reorder"
					use:dndzone={{ items: queueItems, flipDurationMs: 150, delayTouchStart: 300, dropTargetStyle: {} }}
					onconsider={handleDnd}
					onfinalize={handleDndFinalize}
				>
					{#each queueItems as item (item.id)}
						<div class="qrow" class:selected={item.post.path === selectedPath} aria-label={item.post.title}>
							<a class="row" href={postHref(item.post.slug)} draggable="false">
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
		flex: 1;
		flex-direction: column;
		align-items: center;
		gap: 2px;
	}

	.rail-group {
		display: contents;
	}

	.rail-item.tail {
		margin-top: auto;
	}

	.rail-item.new {
		color: var(--ink);
		border: 1px solid var(--line);
		margin-bottom: 4px;
		padding: 6px 0;
	}

	.rail-item.current {
		box-shadow: inset 2px 0 0 var(--accent);
	}

	.rail-pop {
		inset: auto;
		top: anchor(top);
		left: anchor(right);
		margin: 0;
		width: 260px;
		padding: 6px;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--paper);
		color: var(--ink);
		box-shadow: 0 8px 24px var(--shadow);
	}

	.rail-pop h4 {
		margin: 4px 8px 6px;
		color: var(--ink-3);
		font-size: 10.5px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.rail-pop a,
	.rail-pop .more,
	.rail-pop p {
		display: grid;
		grid-template-columns: 7px minmax(0, 1fr);
		gap: 9px;
		align-items: baseline;
		border-radius: 6px;
		color: inherit;
		font: inherit;
		font-size: 13px;
		margin: 0;
		padding: 6px 8px;
		text-decoration: none;
	}

	.rail-pop a:hover,
	.rail-pop a.selected,
	.rail-pop .more:hover {
		background: var(--hover);
	}

	.rail-pop a span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.rail-pop .more {
		display: block;
		width: 100%;
		background: transparent;
		border: none;
		color: var(--ink-2);
		cursor: pointer;
		text-align: left;
	}

	.rail-pop p {
		display: block;
		color: var(--ink-3);
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
