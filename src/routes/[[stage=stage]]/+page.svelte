<script lang="ts">
	import HomePanel from '#lib/components/HomePanel.svelte';
	import { getPosts } from '#lib/posts.remote.js';
	import { countPosts } from '#lib/types.js';

	const { posts } = $derived(await getPosts());

	let recentPosts = $derived(posts.filter((post) => !post.deleteRequested).slice(0, 8));
</script>

<svelte:head>
	<title>Posts · cfcms</title>
</svelte:head>

<HomePanel
	{recentPosts}
	counts={countPosts(posts)}
	llmDrafts={posts.filter((post) => post.path.endsWith('.llm.md')).length}
/>
