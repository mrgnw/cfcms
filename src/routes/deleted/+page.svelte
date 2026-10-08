<script lang="ts">
	import DeletedView from '#lib/components/DeletedView.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>Deleted · cms.xcc.es</title>
</svelte:head>

<DeletedView posts={data.posts.filter((post) => post.deleteRequested)} />
