<script lang="ts">
	import DeletedView from '#lib/components/DeletedView.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>Deleted · cfcms</title>
</svelte:head>

<DeletedView posts={data.posts.filter((post) => post.deleteRequested)} />
