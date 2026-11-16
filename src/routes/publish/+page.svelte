<script lang="ts">
	import PublishView from '#lib/components/PublishView.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>Publish · cfcms</title>
</svelte:head>

<PublishView
	changes={data.pendingChanges}
	lastPublishedAt={data.lastPublishedAt}
	pendingPush={data.pendingPush}
	publicationRecovery={data.publicationRecovery}
	backupStatus={data.backupStatus}
	schedule={data.schedule}
	scheduleDrift={data.scheduleDrift}
/>
