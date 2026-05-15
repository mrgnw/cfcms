<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import PostEditor from '$lib/components/PostEditor.svelte';

	type DeployStatus = 'draft' | 'ready' | 'live' | 'changed' | 'unpublish' | 'delete' | 'deleted';

	type PostListItem = {
		path: string;
		title: string;
		date?: string;
		tags?: string[];
		publish?: boolean;
		pin?: boolean;
		deleteRequested?: boolean;
		slug?: string;
		excerpt?: string;
		updatedAt?: string;
		deployStatus?: DeployStatus;
		deployedAt?: string;
	};

	type Post = PostListItem & {
		frontmatter: string;
		body: string;
	};

	type PublishResult = {
		name: string;
		ok: boolean;
		status: number | null;
		durationMs: number;
		output: string;
	};

	type PublishData = {
		ok: boolean;
		readyCount: number;
		liveCount: number;
		lastPublishedAt: string | null;
		runAt: string;
		push: { ok: boolean; status: number | null; output: string };
		results: PublishResult[];
	};

	type PageData = { posts: PostListItem[]; post: Post | null };

	let { data }: { data: PageData } = $props();

	let sidebarOpen = $state(true);
	let newTitle = $state('');
	let query = $state('');
	let filter = $state<'all' | 'ready' | 'drafts'>('all');

	const pendingStatuses = new Set<DeployStatus>(['ready', 'changed', 'unpublish', 'delete']);

	let readyCount = $derived(data.posts.filter((p) => pendingStatuses.has(p.deployStatus ?? 'draft')).length);
	let draftCount = $derived(data.posts.filter((p) => (p.deployStatus ?? 'draft') === 'draft').length);
	let totalCount = $derived(data.posts.length);

	let filteredPosts = $derived.by(() => {
		const term = query.trim().toLowerCase();
		return data.posts.filter((post) => {
			const status = post.deployStatus ?? 'draft';
			if (filter === 'ready' && !pendingStatuses.has(status)) return false;
			if (filter === 'drafts' && status !== 'draft') return false;
			if (!term) return true;
			return [post.title, post.path, post.slug, post.excerpt, statusLabel(status), ...(post.tags ?? [])]
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
				output.match(
					/https:\/\/[^\s)]+\.workers\.dev[^\s)]*|https:\/\/[^\s)]+\.pages\.dev[^\s)]*/g
				) ?? []
			)
		);
	}

	function statusLabel(status: DeployStatus = 'draft') {
		if (status === 'ready') return 'ready';
		if (status === 'live') return 'live';
		if (status === 'changed') return 'changed';
		if (status === 'unpublish') return 'unpublish';
		if (status === 'delete') return 'delete';
		if (status === 'deleted') return 'deleted';
		return 'draft';
	}
</script>

<svelte:head>
	<title>cms.xcc.es</title>
</svelte:head>

<main class="shell" class:sidebar-closed={!sidebarOpen}>
	<aside class="sidebar" aria-label="Posts">
		<header class="sidebar-head">
			<button
				class="icon-btn"
				type="button"
				onclick={() => (sidebarOpen = !sidebarOpen)}
				aria-label="Toggle sidebar"
				title="Toggle sidebar"
			>
				<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6">
					<path d="M3 4h10M3 8h10M3 12h10" stroke-linecap="round" />
				</svg>
			</button>
			<h1>Posts</h1>
		</header>

		<form class="new-post" method="POST" action="?/create">
			<input
				name="title"
				bind:value={newTitle}
				placeholder="New post title..."
				autocomplete="off"
			/>
			<button disabled={!newTitle.trim()} aria-label="Create post" title="Create post">
				<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8">
					<path d="M8 3v10M3 8h10" stroke-linecap="round" />
				</svg>
			</button>
		</form>

		<div class="filters" aria-label="Filters">
			<button
				class:active={filter === 'all'}
				onclick={() => (filter = 'all')}
				type="button"
			>
				All <em>{totalCount}</em>
			</button>
			<button
				class:active={filter === 'drafts'}
				onclick={() => (filter = 'drafts')}
				type="button"
			>
				Drafts <em>{draftCount}</em>
			</button>
			<button
				class:active={filter === 'ready'}
				onclick={() => (filter = 'ready')}
				type="button"
			>
				Ready <em>{readyCount}</em>
			</button>
			<button class="publish-btn" type="button" onclick={runPublish} disabled={publishing || !readyCount}>
				{publishing ? 'Publishing...' : 'Publish'}
			</button>
		</div>

		<input class="search" type="search" bind:value={query} placeholder="Search…" aria-label="Search posts" />

		<nav class="post-list" aria-label="Post list">
			{#each filteredPosts as item (item.path)}
				<a
					class:selected={item.path === data.post?.path}
					href={resolve(`/?post=${encodeURIComponent(item.path)}`)}
				>
					<strong>{item.title}</strong>
					<span class="post-meta">
						<em class={`deploy-badge ${item.deployStatus ?? 'draft'}`}>{statusLabel(item.deployStatus)}</em>
						<span>{item.date || 'undated'}</span>
						{#if item.pin}<span>pinned</span>{/if}
					</span>
					{#if item.tags?.length}
						<small>{item.tags.join(' · ')}</small>
					{/if}
				</a>
			{:else}
				<p class="empty">No posts match.</p>
			{/each}
		</nav>

		{#if publishResult}
			<section class="publish-result" class:ok={publishResult.ok}>
				<h3>{publishResult.ok ? 'Published' : 'Publish errored'}</h3>
				<p>{publishResult.readyCount} pending · {publishResult.liveCount} live · {new Date(publishResult.runAt).toLocaleTimeString()}</p>
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

	<section class="workbench" aria-label="Editor">
		{#if data.post}
			{#key data.post.path}
				<PostEditor post={data.post} onSaved={() => invalidateAll()} />
			{/key}
		{:else}
			<div class="no-selection">
				<h2>No post selected</h2>
				<p>Create one in the sidebar to begin.</p>
			</div>
		{/if}
	</section>
</main>

<style>
	:global(body) {
		margin: 0;
		background: #f4f1eb;
		color: #241f1a;
		font-family:
			Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
	}

	:global(*) {
		box-sizing: border-box;
	}

	.shell {
		display: grid;
		grid-template-columns: minmax(260px, 320px) 1fr;
		min-height: 100vh;
		transition: grid-template-columns 200ms ease;
	}

	.shell.sidebar-closed {
		grid-template-columns: 44px 1fr;
	}

	.sidebar {
		background: #fbfaf7;
		border-right: 1px solid #ded7ca;
		padding: 14px;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		gap: 14px;
		min-width: 0;
	}

	.shell.sidebar-closed .sidebar > :not(.sidebar-head) {
		display: none;
	}

	.shell.sidebar-closed .sidebar-head h1 {
		display: none;
	}

	.shell.sidebar-closed .sidebar {
		padding: 14px 6px;
	}

	.sidebar-head {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.sidebar-head h1 {
		font-size: 22px;
		letter-spacing: -0.03em;
		margin: 0;
		flex: 1;
	}

	.icon-btn {
		background: transparent;
		border: 1px solid transparent;
		border-radius: 8px;
		color: #5a5148;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 6px;
	}

	.icon-btn:hover {
		background: #f0ebe1;
		border-color: #d8d0c2;
	}

	.new-post {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 34px;
		gap: 6px;
	}

	.new-post input {
		border: 1px solid #d8d0c2;
		border-radius: 8px;
		padding: 8px 10px;
		background: #fffdf8;
		font: inherit;
		min-width: 0;
	}

	.new-post button {
		background: #27211b;
		color: #fffaf0;
		border: 1px solid #27211b;
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
		border: 1px solid transparent;
		border-radius: 7px;
		color: #5a5148;
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
		color: #a89e8d;
		font-size: 11px;
	}

	.filters button.active {
		background: #27211b;
		color: #fffaf0;
	}

	.filters button.active em {
		color: #c9bda9;
	}

	.filters button:hover:not(.active) {
		background: #f0ebe1;
	}

	.publish-btn {
		background: #3c7a44 !important;
		color: #fffaf0 !important;
		border-color: #3c7a44 !important;
		text-transform: uppercase;
	}

	.publish-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.search {
		border: 1px solid #d8d0c2;
		border-radius: 8px;
		padding: 8px 10px;
		font: inherit;
		background: #fffdf8;
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
		background: #f0ebe1;
	}

	.post-list a.selected {
		background: #ede5d6;
	}

	.post-meta,
	.post-list small {
		color: #8a7f70;
		font-size: 11px;
	}

	.post-meta {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}

	.deploy-badge {
		border-radius: 999px;
		font-style: normal;
		font-size: 10px;
		font-weight: 650;
		line-height: 1;
		padding: 3px 6px;
		text-transform: uppercase;
	}

	.deploy-badge.draft,
	.deploy-badge.deleted {
		background: #eee8dc;
		color: #766b5e;
	}

	.deploy-badge.ready,
	.deploy-badge.changed {
		background: #f4e6b8;
		color: #7b5a10;
	}

	.deploy-badge.live {
		background: #e7f0df;
		color: #3c7a44;
	}

	.deploy-badge.unpublish,
	.deploy-badge.delete {
		background: #fbe9e6;
		color: #8a463c;
	}

	.empty {
		color: #8a7f70;
		font-size: 13px;
		text-align: center;
		padding: 14px;
	}

	.workbench {
		min-width: 0;
		padding: 20px 24px;
		overflow-y: auto;
	}

	.no-selection {
		display: grid;
		place-items: center;
		min-height: 70vh;
		text-align: center;
		color: #8a7f70;
	}

	.publish-result {
		border-left: 3px solid #a43b2f;
		display: grid;
		gap: 8px;
		padding-left: 10px;
		font-size: 12px;
	}

	.publish-result.ok {
		border-color: #3c7a44;
	}

	.publish-result h3 {
		margin: 0;
		font-size: 13px;
	}

	.publish-result details {
		background: #fffdf8;
		border: 1px solid #d8d0c2;
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
		color: #8a463c;
	}

	.publish-result.ok summary em {
		color: #3c7a44;
	}

	.links {
		display: grid;
		gap: 4px;
		margin-top: 6px;
	}

	.links a {
		color: #7c3f31;
		font-size: 11px;
		word-break: break-all;
	}

	.error {
		color: #8a463c;
		font-size: 12px;
	}

	@media (max-width: 720px) {
		.shell {
			grid-template-columns: 1fr;
		}
		.shell.sidebar-closed .sidebar {
			display: none;
		}
	}
</style>
