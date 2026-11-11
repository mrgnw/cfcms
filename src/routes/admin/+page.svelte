<script lang="ts">
	import AdminView from '#lib/components/AdminView.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>Admin · cfcms</title>
</svelte:head>

<AdminView llmDrafts={data.llmDrafts} />
