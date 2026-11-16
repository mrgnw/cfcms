<script lang="ts">
	import { refreshAll } from '$app/navigation';

	let { publication, backup, disabled = false, onPublicationVerified }: {
		publication: { pendingCommit: string | null; message: string | null };
		backup: { pendingCommit: string | null; error: string | null; message: string | null; remoteCommit: string | null };
		disabled?: boolean;
		onPublicationVerified?: () => void;
	} = $props();

	const replacementId = $props.id();
	let busy = $state(false);
	let message = $state('');
	let unresolved = $state<string[]>([]);
	let failed = $state(false);
	let replacementApproved = $state(false);

	$effect(() => {
		backup.pendingCommit;
		backup.remoteCommit;
		replacementApproved = false;
	});

	async function recover(kind: 'publish' | 'backup', commit: string, replace?: string, retry = false) {
		if (busy || disabled) return;
		busy = true;
		replacementApproved = false;
		message = '';
		unresolved = [];
		try {
			const query = new URLSearchParams({ commit });
			if (replace) query.set('replace', replace);
			if (retry) query.set('retry', '1');
			const response = await fetch(`/api/${kind}/reconcile?${query}`, { method: 'POST' });
			const report = await response.json();
			failed = !response.ok;
			message = report.message ?? 'Recovery verification failed';
			if (Array.isArray(report.paths)) unresolved = report.paths;
			if (response.ok && kind === 'publish') onPublicationVerified?.();
			await refreshAll();
		} catch (caught) {
			failed = true;
			message = caught instanceof Error ? caught.message : 'Recovery request failed';
		} finally {
			busy = false;
		}
	}
</script>

{#if publication.pendingCommit}
	<section>
		<h3>Publication push pending</h3>
		{#if publication.message !== message}
			<p>{publication.message || 'If you rebased or pushed this publication manually, verify remote delivery to resume publishing. Verification preserves your saved edits and checkout.'}</p>
		{/if}
		<div class="actions">
			<button type="button" disabled={busy || disabled} onclick={() => recover('publish', publication.pendingCommit!)}>Verify remote delivery</button>
			<a href={`/api/publish/reconcile?patch=${publication.pendingCommit}`} download>Download captured patch</a>
		</div>
	</section>
{/if}

{#if backup.pendingCommit || backup.error}
	<section>
		<h3>Backup needs attention</h3>
		{#if backup.error && backup.error !== message}<p class="failure">{backup.error}</p>{/if}
		{#if backup.pendingCommit}
			{#if backup.message && backup.message !== message}<p>{backup.message}</p>{/if}
			<div class="actions">
				<button type="button" disabled={busy || disabled || Boolean(publication.pendingCommit)} onclick={() => recover('backup', backup.pendingCommit!, undefined, true)}>Retry backup push</button>
				<button type="button" disabled={busy || disabled} onclick={() => recover('backup', backup.pendingCommit!)}>Verify backup delivery</button>
			</div>
			{#if backup.remoteCommit && !publication.pendingCommit}
				<label for={replacementId}>
					<input id={replacementId} type="checkbox" bind:checked={replacementApproved} disabled={busy || disabled} />
					Replace the saved backup with a fresh snapshot of the current CMS database.
				</label>
				<button type="button" disabled={busy || disabled || !replacementApproved}
					onclick={() => recover('backup', backup.pendingCommit!, backup.remoteCommit!)}>Replace backup and push</button>
			{/if}
		{:else}
			<p>Backups retry after the checkout and remote are available. The most recent failure stays visible here until a backup succeeds.</p>
		{/if}
	</section>
{/if}

<div role="status" aria-atomic="true">
	{#if message}
		<p class:failure={failed}>{message}</p>
		{#if unresolved.length}<p>Unverified paths: {unresolved.join(', ')}</p>{/if}
	{/if}
</div>

<style>
	section {
		border-top: 1px solid var(--line);
		padding-top: 12px;
	}

	h3 {
		margin: 0 0 8px;
		font-size: 14px;
	}

	p, label {
		font-size: 13px;
		line-height: 1.5;
		overflow-wrap: anywhere;
	}

	p {
		margin: 8px 0;
	}

	.actions, label {
		display: flex;
		gap: 10px;
		align-items: baseline;
		flex-wrap: wrap;
	}

	label {
		align-items: start;
		flex-wrap: nowrap;
		margin: 12px 0 8px;
	}

	input {
		accent-color: var(--accent);
		margin-top: 4px;
	}

	button, a {
		min-height: 28px;
		font: inherit;
		font-size: 13px;
	}

	button {
		border: 1px solid var(--line);
		border-radius: 6px;
		background: var(--hover);
		color: var(--ink);
		padding: 4px 10px;
		cursor: pointer;
	}

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	a {
		color: var(--accent-ink);
	}

	.failure {
		color: var(--danger);
	}
</style>
