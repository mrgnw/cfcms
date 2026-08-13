<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import DeletedView from '$lib/components/DeletedView.svelte';
	import HomePanel from '$lib/components/HomePanel.svelte';
	import PostEditor from '$lib/components/PostEditor.svelte';
	import PublishView from '$lib/components/PublishView.svelte';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import {
		isEditing,
		isPending,
		statusOf,
		type LlmDraft,
		type PendingChange,
		type Post,
		type PostFilter,
		type PostListItem
	} from '$lib/types';

	type PageData = {
		posts: PostListItem[];
		post: Post | null;
		llmDraft: LlmDraft | null;
		view: 'publish' | 'deleted' | null;
		pendingChanges: PendingChange[] | null;
		lastPublishedAt: string | null;
	};

	let { data }: { data: PageData } = $props();

	let sidebarOpen = $state(true);
	let newTitle = $state('');
	let filter = $state<PostFilter>('all');

	let deletedPosts = $derived(data.posts.filter((p) => p.deleteRequested));
	let livePosts = $derived(data.posts.filter((p) => !p.deleteRequested));

	let counts = $derived({
		all: livePosts.length,
		drafts: livePosts.filter((p) => statusOf(p) === 'draft').length,
		ready: livePosts.filter((p) => isPending(statusOf(p))).length,
		editing: livePosts.filter(isEditing).length,
		deleted: deletedPosts.length
	});

	let recentPosts = $derived(livePosts.slice(0, 8));
</script>

<svelte:head>
	<title>{data.view === 'publish' ? 'Publish' : data.view === 'deleted' ? 'Deleted' : (data.post?.title ?? 'Posts')} · cms.xcc.es</title>
</svelte:head>

<main class="shell" class:sidebar-closed={!sidebarOpen} class:has-post={Boolean(data.post || data.view)}>
	<Sidebar
		posts={data.posts}
		selectedPath={data.post?.path}
		{counts}
		bind:open={sidebarOpen}
		bind:newTitle
		bind:filter
	/>

	<section class="workbench" aria-label="Editor">
		{#if data.view === 'publish'}
			<PublishView changes={data.pendingChanges ?? []} lastPublishedAt={data.lastPublishedAt} />
		{:else if data.view === 'deleted'}
			<DeletedView posts={deletedPosts} />
		{:else if data.post}
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
			<HomePanel {recentPosts} {counts} bind:newTitle bind:filter />
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

	.mobile-back {
		display: none;
	}

	@media (max-width: 720px) {
		.shell,
		.shell.sidebar-closed {
			grid-template-columns: 1fr;
			height: 100vh;
		}
		/* master–detail: show the list OR the editor, never stacked */
		.shell:not(.has-post) .workbench {
			display: none;
		}
		.shell.has-post :global(.sidebar) {
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
