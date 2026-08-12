<script lang="ts">
	import { isEditing, statusOf, type PostListItem } from '$lib/types';

	let { post }: { post: Pick<PostListItem, 'deployStatus' | 'editingOrder'> } = $props();

	let status = $derived(statusOf(post));
</script>

{#if isEditing(post)}
	<em class="deploy-badge edit">editing</em>
{/if}
{#if status !== 'draft'}
	<em class="deploy-badge {status}">{status}</em>
{/if}

<style>
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
</style>
