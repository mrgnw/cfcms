<script lang="ts">
	import DeletedView from '#lib/components/DeletedView.svelte';
	import { getPosts } from '#lib/posts.remote.js';

	const { posts } = $derived(await getPosts());
</script>

<svelte:head>
	<title>Deleted · cfcms</title>
</svelte:head>

<DeletedView posts={posts.filter((post) => post.deleteRequested)} />
