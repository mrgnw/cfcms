<script lang="ts">
	import HomePanel from '#lib/components/HomePanel.svelte';
	import { countPosts } from '#lib/types.js';
	import { getUiState } from '#lib/ui-state.js';

	let { data } = $props();

	const ui = getUiState();

	let recentPosts = $derived(data.posts.filter((post) => !post.deleteRequested).slice(0, 8));
</script>

<svelte:head>
	<title>Posts · cms.xcc.es</title>
</svelte:head>

<HomePanel
	{recentPosts}
	counts={countPosts(data.posts)}
	llmDrafts={data.posts.filter((post) => post.path.endsWith('.llm.md')).length}
	bind:filter={ui.filter}
/>

