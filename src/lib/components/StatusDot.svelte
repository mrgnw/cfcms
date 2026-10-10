<script lang="ts">
	import type { DeployStatus } from '#lib/types.js';

	let { status }: { status: DeployStatus } = $props();
</script>

<i class="dot {status}" role="img" aria-label={status} title={status}></i>

<style>
	.dot {
		align-self: center;
		flex: none;
		width: 7px;
		height: 7px;
		border: 1.5px solid var(--ink-3);
		border-radius: 50%;
	}

	.dot.ready {
		background: var(--warn);
		border-color: var(--warn);
	}

	.dot.changed {
		border-color: var(--warn);
	}

	.dot.live {
		background: var(--ok);
		border-color: var(--ok);
	}

	.dot.unpublish,
	.dot.delete {
		border-color: var(--danger);
	}
</style>
