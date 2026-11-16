<script lang="ts">
	import { refreshAll } from '$app/navigation';
	import type { PublicationRecoveryPreview, PublicationRemoteState } from '#lib/types.js';

	let { publication, backup, disabled = false, onPublicationVerified }: {
		publication: PublicationRecoveryPreview;
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
	let historicalCommit = $state('');
	let historicalApproved = $state(false);
	let outputApproved = $state(false);
	let confirmedRemote = $state<PublicationRemoteState | null>(null);

	$effect(() => {
		backup.pendingCommit;
		backup.remoteCommit;
		replacementApproved = false;
	});

	$effect(() => {
		publication.pendingCommit;
		publication.remoteCommit;
		historicalApproved = false;
	});

	$effect(() => {
		publication.reconciliation?.review?.token;
		outputApproved = false;
	});

	$effect(() => {
		if (disabled) {
			message = '';
			unresolved = [];
			confirmedRemote = null;
		}
	});

	async function recover(kind: 'publish' | 'backup', commit: string, replace?: string, retry = false,
		selected?: { commit: string; remote: string }) {
		if (busy || disabled) return;
		busy = true;
		replacementApproved = false;
		historicalApproved = false;
		message = '';
		confirmedRemote = null;
		unresolved = [];
		try {
			const query = new URLSearchParams({ commit });
			if (replace) query.set('replace', replace);
			if (retry) query.set('retry', '1');
			if (selected) {
				query.set('delivered', selected.commit);
				query.set('remote', selected.remote);
				query.set('confirm', 'reviewed-history-and-current-remote');
			}
			const response = await fetch(`/api/${kind}/reconcile?${query}`, { method: 'POST' });
			const report = await response.json();
			failed = !response.ok;
			message = report.message ?? 'Recovery verification failed';
			if (Array.isArray(report.paths)) unresolved = report.paths;
			if (kind === 'publish') confirmedRemote = report.currentRemote ?? null;
			if (response.ok && kind === 'publish') onPublicationVerified?.();
			await refreshAll();
		} catch (caught) {
			failed = true;
			message = caught instanceof Error ? caught.message : 'Recovery request failed';
		} finally {
			busy = false;
		}
	}

	async function approveOutput(form: HTMLFormElement) {
		if (busy || disabled) return;
		busy = true;
		message = '';
		try {
			const data = new FormData(form);
			const body = new URLSearchParams();
			for (const [name, value] of data) if (typeof value === 'string') body.set(name, value);
			const response = await fetch('/api/publish/output', { method: 'POST', body });
			const report = await response.json();
			failed = !response.ok;
			message = report.message ?? 'Output approval failed';
			await refreshAll();
		} catch (caught) {
			failed = true;
			message = caught instanceof Error ? caught.message : 'Output approval failed';
		} finally {
			busy = false;
			outputApproved = false;
		}
	}
</script>

{#snippet remoteSnapshot(state: PublicationRemoteState)}
	<div class="remote-snapshot">
		<h4>Git remote snapshot at verification</h4>
		<p><code>{state.remoteCommit}</code></p>
		{#if state.differences.length}
			<p>These captured paths differ from the publication snapshot:</p>
			<ul>
				{#each state.differences as difference (difference.path)}
					<li><code>{difference.path}</code> · {difference.kind === 'deleted' ? 'Absent from remote'
						: difference.kind === 'restored' ? 'Present remotely; absent from captured snapshot'
							: difference.kind === 'type-changed' ? 'File type changed remotely' : 'Changed from captured snapshot'}
						{#if difference.matchesBefore} · matches pre-publication snapshot{/if}</li>
				{/each}
			</ul>
		{:else}
			<p>No captured paths differ at this verified Git remote tip.</p>
		{/if}
		<p>Historical Git delivery does not establish current live content. This confirmation changes no post content and does not verify deployment. Later publishing is blocked if it would overwrite these reported paths; reconcile them explicitly first.</p>
	</div>
{/snippet}

{#if publication.reconciliation}
	<section class="protection">
		<h3>Remote reconciliation required before publishing</h3>
		{#if publication.reconciliation.error}
			<p>{publication.reconciliation.error}</p>
		{:else}
			<p>Historical confirmation left the CMS publication records unchanged. Publishing still renders those posts. A candidate that would overwrite the reported remote changes is rejected before commit unless you explicitly approve its exact protected-path patch.</p>
			<ul>
				{#each publication.reconciliation.paths as path (path)}<li><code>{path}</code></li>{/each}
			</ul>
			<p>To keep a remote removal, explicitly unpublish/delete the affected post and stage that decision. For other edits, reconcile the CMS output with the remote, or review and approve the exact candidate below. Retry publishing to generate a fresh preview after changing your decision. Nothing is unpublished or accepted automatically.</p>
			{#if publication.reconciliation.review}
				{@const review = publication.reconciliation.review}
				<details>
					<summary>Review protected output</summary>
					<h4 id={`${replacementId}-output-heading`}>Replace the listed remote paths on next publish</h4>
					<p>This is the last blocked candidate, compared with Git remote <code>{review.remoteCommit}</code>. Approval permits exactly these changes, including any additions or deletions shown. It does not publish or change files now.</p>
					<ul>{#each review.paths as path (path)}<li><code>{path}</code></li>{/each}</ul>
					<label class="field-label" for={`${replacementId}-output-patch`}>Exact protected-path changes from remote to candidate</label>
					<textarea id={`${replacementId}-output-patch`} readonly rows="14" value={review.patch}></textarea>
					<p>Candidate snapshot: <code>{review.candidateTree}</code>. A changed candidate, local commit, or remote snapshot requires a fresh review. Other staged changes retain the normal publishing approval rules.</p>
					{#if review.approved}
						<p>Approved for this exact output and remote snapshot. Retry publishing; the server checks them again before committing.</p>
					{:else}
						<form method="POST" action="/api/publish/output" aria-labelledby={`${replacementId}-output-heading`}
							onsubmit={(event) => { event.preventDefault(); void approveOutput(event.currentTarget); }}>
							<input type="hidden" name="token" value={review.token} />
							<input type="hidden" name="remote" value={review.remoteCommit} />
							<label for={`${replacementId}-output-confirm`}>
								<input id={`${replacementId}-output-confirm`} name="confirm" type="checkbox" value="reviewed-protected-output"
									bind:checked={outputApproved} required disabled={busy || disabled} />
								I reviewed every change in this patch. Replace these protected remote paths with this exact output on the next publish (required).
							</label>
							<button type="submit" disabled={busy || disabled}>Approve exact protected output</button>
						</form>
					{/if}
				</details>
			{/if}
		{/if}
	</section>
{/if}

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
		{#if publication.remoteCommit && publication.currentRemote}
			{@render remoteSnapshot(publication.currentRemote)}
			<details>
				<summary>Confirm historical Git delivery</summary>
				<p id={`${replacementId}-history-help`}>Enter the full commit hash from your successful manual push. Confirm only a commit you reviewed as delivering this publication. Matching content alone does not establish delivery. Confirmation leaves CMS publication records unchanged; reconcile the reported differences before publishing again.</p>
				<form method="POST" action="/api/publish/reconcile" onsubmit={(event) => {
					event.preventDefault();
					void recover('publish', publication.pendingCommit!, undefined, false,
						{ commit: historicalCommit, remote: publication.remoteCommit! });
				}}>
					<input type="hidden" name="commit" value={publication.pendingCommit} />
					<input type="hidden" name="remote" value={publication.remoteCommit} />
					<label class="field-label" for={`${replacementId}-delivered`}>Historical delivery commit (required)</label>
					<input id={`${replacementId}-delivered`} name="delivered" type="text" bind:value={historicalCommit}
						oninput={() => historicalApproved = false} required minlength="40" maxlength="64" pattern={'[0-9a-f]{40}([0-9a-f]{24})?'}
						autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false"
						aria-describedby={`${replacementId}-history-help`} disabled={busy || disabled} />
					<label for={`${replacementId}-history-confirm`}>
						<input id={`${replacementId}-history-confirm`} name="confirm" type="checkbox" value="reviewed-history-and-current-remote"
							bind:checked={historicalApproved} required disabled={busy || disabled} />
						I reviewed this historical commit and the remote differences above. Confirm past Git delivery only; these differences still require reconciliation before publishing again.
					</label>
					<button type="submit" disabled={busy || disabled}>Verify historical Git delivery</button>
				</form>
			</details>
		{:else if publication.remoteCommit}
			<p class="failure">{publication.currentRemoteError || 'The complete current remote comparison is unavailable.'} Verify again before confirming historical delivery.</p>
		{/if}
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
		{#if !publication.pendingCommit && confirmedRemote}{@render remoteSnapshot(confirmedRemote)}{/if}
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

	h4 {
		font-size: 13px;
		margin: 12px 0 4px;
	}

	.remote-snapshot {
		font-size: 13px;
		line-height: 1.5;
		overflow-wrap: anywhere;
	}

	.remote-snapshot ul {
		padding-left: 18px;
	}

	.remote-snapshot code {
		white-space: pre-wrap;
	}

	.protection {
		border-left: 2px solid var(--warn);
		padding-left: 10px;
		font-size: 13px;
		line-height: 1.5;
		overflow-wrap: anywhere;
	}

	.protection ul {
		padding-left: 18px;
	}

	.protection code {
		white-space: pre-wrap;
	}

	.protection textarea {
		box-sizing: border-box;
		inline-size: 100%;
		max-block-size: 24rem;
		overflow: auto;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		font-size: 12px;
		font-family: var(--font-mono, monospace);
		line-height: 1.5;
		padding: 10px;
		border: 1px solid var(--line);
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

	input[type='checkbox'] {
		accent-color: var(--accent);
		margin-top: 4px;
	}

	details {
		margin-top: 12px;
		font-size: 13px;
	}

	summary {
		cursor: pointer;
	}

	.field-label {
		display: block;
		margin-bottom: 4px;
	}

	input[type='text'] {
		box-sizing: border-box;
		width: 100%;
		min-height: 40px;
		padding: 8px;
		border: 1px solid var(--ink-3);
		border-radius: 6px;
		font: inherit;
		font-size: 16px;
		background: var(--bg);
		color: var(--ink);
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
