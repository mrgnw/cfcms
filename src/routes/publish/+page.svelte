<script lang="ts">
	import PublishView from '#lib/components/PublishView.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>Publish · cms.xcc.es</title>
</svelte:head>

<PublishView changes={data.pendingChanges} lastPublishedAt={data.lastPublishedAt} />
