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
		editRequested?: boolean;
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

	type PageData = {
		posts: PostListItem[];
		post: Post | null;
		llmDraft: { path: string; body: string } | null;
	};

	let { data }: { data: PageData } = $props();

	let sidebarOpen = $state(true);
	let newTitle = $state('');
	let query = $state('');
	let filter = $state<'all' | 'ready' | 'drafts' | 'edit'>('all');

	const pendingStatuses = new Set<DeployStatus>(['ready', 'changed', 'unpublish', 'delete']);

	let readyCount = $derived(data.posts.filter((p) => pendingStatuses.has(p.deployStatus ?? 'draft')).length);
	let draftCount = $derived(data.posts.filter((p) => (p.deployStatus ?? 'draft') === 'draft').length);
	let editCount = $derived(data.posts.filter((p) => p.editRequested).length);
	let totalCount = $derived(data.posts.length);

	let recentPosts = $derived(
		data.posts.filter((p) => (p.deployStatus ?? 'draft') !== 'deleted').slice(0, 8)
	);

	let filteredPosts = $derived.by(() => {
		const term = query.trim().toLowerCase();
		return data.posts.filter((post) => {
			const status = post.deployStatus ?? 'draft';
			if (filter === 'ready' && !pendingStatuses.has(status)) return false;
			if (filter === 'drafts' && status !== 'draft') return false;
			if (filter === 'edit' && !post.editRequested) return false;
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
	<title>{data.post?.title ?? 'Posts'} · cms.xcc.es</title>
</svelte:head>

<main class="shell" class:sidebar-closed={!sidebarOpen} class:has-post={Boolean(data.post)}>
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
		</header>

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
			<button
				class:active={filter === 'edit'}
				onclick={() => (filter = 'edit')}
				type="button"
			>
				Edit <em>{editCount}</em>
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
						{#if item.editRequested}
							<em class="deploy-badge edit">edit</em>
						{/if}
						{#if (item.deployStatus ?? 'draft') !== 'draft'}
							<em class={`deploy-badge ${item.deployStatus}`}>{statusLabel(item.deployStatus)}</em>
						{/if}
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

		<button class="publish-btn" type="button" onclick={runPublish} disabled={publishing || !readyCount}>
			{publishing ? 'Publishing…' : readyCount ? `Publish ${readyCount}` : 'Publish'}
		</button>

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
			<a class="mobile-back" href={resolve('/')} aria-label="Back to post list">
				<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7">
					<path d="M10 3 5 8l5 5" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
				Posts
			</a>
			{#key data.post.path}
				<div class="post-enter">
					<PostEditor post={data.post} llmDraft={data.llmDraft} onSaved={() => invalidateAll()} />
				</div>
			{/key}
		{:else}
			<div class="home">
				<header class="home-head">
					<h2>Welcome back.</h2>
					<p>Pick up where you left off, or start something new.</p>
				</header>

				<form class="home-new" method="POST" action="?/create">
					<input name="title" bind:value={newTitle} placeholder="New post title…" autocomplete="off" />
					<button disabled={!newTitle.trim()}>Create post</button>
				</form>

				<div class="home-stats">
					<button type="button" class="stat" onclick={() => (filter = 'all')}>
						<em>{totalCount}</em><span>All</span>
					</button>
					<button type="button" class="stat" onclick={() => (filter = 'drafts')}>
						<em>{draftCount}</em><span>Drafts</span>
					</button>
					<button type="button" class="stat" onclick={() => (filter = 'ready')}>
						<em>{readyCount}</em><span>Ready</span>
					</button>
					<button type="button" class="stat" onclick={() => (filter = 'edit')}>
						<em>{editCount}</em><span>Edit</span>
					</button>
				</div>

				<section class="home-recent">
					<h3>Recent</h3>
					<div class="recent-grid">
						{#each recentPosts as item (item.path)}
							<a class="recent-card" href={resolve(`/?post=${encodeURIComponent(item.path)}`)}>
								<strong>{item.title}</strong>
								<span class="recent-meta">
									{#if item.editRequested}<em class="deploy-badge edit">edit</em>{/if}
									{#if (item.deployStatus ?? 'draft') !== 'draft'}
										<em class={`deploy-badge ${item.deployStatus}`}>{statusLabel(item.deployStatus)}</em>
									{/if}
									<span>{item.date || 'undated'}</span>
								</span>
								{#if item.tags?.length}<small>{item.tags.slice(0, 4).join(' · ')}</small>{/if}
							</a>
						{/each}
					</div>
				</section>
			</div>
		{/if}
	</section>
</main>

<style>
	.shell {
		display: grid;
		grid-template-columns: minmax(260px, 320px) 1fr;
		height: 100vh;
		transition: grid-template-columns 200ms ease;
	}

	.shell.sidebar-closed {
		grid-template-columns: 44px 1fr;
	}

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
		.shell.sidebar-closed .sidebar > :not(.sidebar-head) {
			display: none;
		}

		.shell.sidebar-closed .new-post {
			display: none;
		}

		.shell.sidebar-closed .sidebar {
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

	.deploy-badge {
		border-radius: 999px;
		font-style: normal;
		font-size: 10px;
		font-weight: 650;
		line-height: 1;
		padding: 3px 6px;
		text-transform: uppercase;
	}

	.deploy-badge.deleted {
		background: var(--hover);
		color: var(--ink-2);
	}

	.deploy-badge.ready,
	.deploy-badge.changed {
		background: color-mix(in srgb, var(--warn) 16%, transparent);
		color: var(--warn);
	}

	.deploy-badge.edit {
		background: color-mix(in srgb, var(--accent) 14%, transparent);
		color: var(--accent-ink);
	}

	.deploy-badge.live {
		background: color-mix(in srgb, var(--ok) 14%, transparent);
		color: var(--ok);
	}

	.deploy-badge.unpublish,
	.deploy-badge.delete {
		background: color-mix(in srgb, var(--danger) 12%, transparent);
		color: var(--danger);
	}

	.empty {
		color: var(--ink-3);
		font-size: 13px;
		text-align: center;
		padding: 14px;
	}

	.workbench {
		background: var(--paper);
		min-width: 0;
		padding: 28px 40px;
		overflow-y: auto;
	}

	.post-enter {
		animation: enter 180ms ease-out;
	}

	@keyframes enter {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
	}

	.home {
		max-width: 760px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 28px;
		padding-top: 4vh;
	}

	.home-head h2 {
		font-family: var(--font-display);
		font-size: 34px;
		font-weight: 600;
		letter-spacing: -0.01em;
		margin: 0 0 6px;
	}

	.home-head p {
		margin: 0;
		color: var(--ink-3);
	}

	.home-new {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 8px;
	}

	.home-new input {
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 11px 14px;
		background: var(--bg);
		font: inherit;
		min-width: 0;
	}

	.home-new input:focus {
		outline: none;
		border-color: var(--accent);
	}

	.home-new button {
		background: var(--accent);
		border: none;
		border-radius: 10px;
		color: #fff;
		cursor: pointer;
		font: inherit;
		font-weight: 600;
		padding: 0 16px;
	}

	.home-new button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.home-stats {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 10px;
	}

	.stat {
		background: var(--bg);
		border: 1px solid var(--line);
		border-radius: 12px;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		gap: 2px;
		font: inherit;
		padding: 14px 16px;
		text-align: left;
	}

	.stat:hover {
		background: var(--hover);
	}

	.stat em {
		font-family: var(--font-display);
		font-size: 26px;
		font-style: normal;
		font-weight: 600;
		line-height: 1;
	}

	.stat span {
		color: var(--ink-3);
		font-size: 12px;
	}

	.home-recent h3 {
		color: var(--ink-3);
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.06em;
		margin: 0 0 12px;
		text-transform: uppercase;
	}

	.recent-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
	}

	.recent-card {
		border: 1px solid var(--line);
		border-radius: 12px;
		color: inherit;
		display: grid;
		gap: 5px;
		padding: 12px 14px;
		text-decoration: none;
	}

	.recent-card:hover {
		background: var(--hover);
	}

	.recent-card strong {
		font-size: 14px;
		line-height: 1.3;
	}

	.recent-meta {
		align-items: center;
		color: var(--ink-3);
		display: flex;
		font-size: 11px;
		gap: 6px;
	}

	.recent-card small {
		color: var(--ink-3);
		font-size: 11px;
	}

	@media (max-width: 720px) {
		.home-stats {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.recent-grid {
			grid-template-columns: minmax(0, 1fr);
		}
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

	.mobile-back {
		display: none;
	}

	@media (max-width: 720px) {
		.shell,
		.shell.sidebar-closed {
			grid-template-columns: 1fr;
			height: 100vh;
		}
		.sidebar {
			border-right: none;
		}
		/* master–detail: show the list OR the editor, never stacked */
		.shell:not(.has-post) .workbench {
			display: none;
		}
		.shell.has-post .sidebar {
			display: none;
		}
		.workbench {
			padding: 16px;
		}
		.mobile-back {
			display: inline-flex;
			align-items: center;
			gap: 4px;
			background: var(--bg);
			border: 1px solid var(--line);
			border-radius: 999px;
			color: var(--ink-2);
			font-size: 13px;
			padding: 6px 12px 6px 10px;
			margin-bottom: 16px;
			text-decoration: none;
			width: fit-content;
		}
	}
</style>
