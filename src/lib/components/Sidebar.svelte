<script lang="ts">
	import { goto, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import PostList from './PostList.svelte';
	import StagePipeline from './StagePipeline.svelte';
	import StatusDot from './StatusDot.svelte';
	import { glyphs, type Glyph } from '#lib/glyphs.js';
	import { rememberSidebar } from '#lib/ui-state.js';
	import { editingQueue, inStage, isEditing, isStage, statusOf, type PostCounts, type PostFilter, type PostListItem, type Stage } from '#lib/types.js';

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

	let visiblePosts = $derived(posts.filter((post) => !post.deleteRequested));

	type Section = 'drafts' | 'editing' | 'recent' | 'ready' | 'live';

	let sectionPosts = $derived<Record<Section, PostListItem[]>>({
		drafts: visiblePosts.filter((post) => inStage(post, 'drafts')),
		editing: editingQueue(visiblePosts),
		recent: visiblePosts.filter((post) => !isEditing(post)).slice(0, 5),
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
		const pathname = page.route.id === '/[[stage=stage]]/posts/[slug]' ?`/posts/${page.params.slug}` : page.url.pathname;
		const rest = underStage ? pathname.replace(/^\/(drafts|ready|live)(?=\/|$)/, '') : '';
		const path = (stage ? `/${stage}` : '') + rest;
		return (path || '/') + hash;
	}

	const sectionHref = (section: Section) => isStage(section) ? stageHref(section) : stageHref(undefined, `#${section}`);

	function leaveRail() {
		setOpen(true);
		query = '';
	}

	function hidePops() {
		for (const pop of document.querySelectorAll<HTMLElement>('.rail-pop:popover-open')) pop.hidePopover();
	}

	function setOpen(value: boolean) {
		open = value;
		hidePops();
		rememberSidebar(value);
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

</script>

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
			onclick={leaveRail}
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
				<a class="more" href={sectionHref(section)} onclick={leaveRail}>+{items.length - 8} more</a>
			{/if}
		</div>
	</div>
{/snippet}

<svelte:window onkeydown={handleShortcut}></svelte:window>

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
	<nav class="rail" aria-label="Jump to" onclick={hidePops}>
		<a class="rail-item new" href={resolve('new')} title="New post" aria-label="New post">
			{@render glyph('plus')}
		</a>
		{#each stages as section (section)}
			{#if section !== 'editing' || sectionPosts.editing.length}
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

	<PostList posts={visiblePosts} {selectedPath} {filter} {query} />


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

		.sidebar:not(.closed) {
			width: var(--sidebar-width);
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
		width: 32px;
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
	}
</style>
