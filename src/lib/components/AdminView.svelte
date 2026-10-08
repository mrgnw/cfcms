<script lang="ts">
	import { deserialize } from '$app/forms';
	import { goto, refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { LlmDraftStatus } from '#lib/llm-drafts.js';

	let { llmDrafts }: { llmDrafts: LlmDraftStatus[] } = $props();

	let busy = $state<string | null>(null);
	let message = $state('');
	let error = $state<string | null>(null);

	const standalone = $derived(llmDrafts.filter((draft) => draft.relation === 'standalone'));
	const byName = $derived(llmDrafts.filter((draft) => draft.relation === 'by-name'));
	const samePath = $derived(llmDrafts.filter((draft) => draft.relation === 'same-path'));

	const when = (mtimeMs: number) => (mtimeMs ? new Date(mtimeMs).toISOString().slice(0, 10) : 'unknown date');

	async function post(action: string, fd: FormData) {
		const res = await fetch(`?/${action}`, { method: 'POST', body: fd }).catch(() => null);
		if (!res) throw new Error('Network error');
		const result = deserialize(await res.text());
		if (result.type !== 'success') throw new Error(`HTTP ${res.status}`);
		return result.data as Record<string, unknown>;
	}

	async function importDraft(draft: LlmDraftStatus, open: boolean) {
		busy = draft.path;
		error = null;
		message = '';
		const fd = new FormData();
		fd.set('path', draft.path);
		try {
			const data = (await post('importLlmDraft', fd)) as { imported: { path: string; created: boolean; slug: string } };
			if (open) {
				await goto(resolve('/posts/[slug]', { slug: data.imported.slug }), { refreshAll: true });
				return;
			}
			message = data.imported.created ? `Imported ${draft.path} as ${data.imported.path}` : `${data.imported.path} already exists`;
			await refreshAll();
		} catch (caught) {
			error = caught instanceof Error ? caught.message : String(caught);
		} finally {
			busy = null;
		}
	}

	async function importAll() {
		busy = '*';
		error = null;
		message = '';
		try {
			const data = (await post('importLlm', new FormData())) as { importedLlm: number };
			message = `Imported ${data.importedLlm} LLM ${data.importedLlm === 1 ? 'draft' : 'drafts'}`;
			await refreshAll();
		} catch (caught) {
			error = caught instanceof Error ? caught.message : String(caught);
		} finally {
			busy = null;
		}
	}
</script>

<div class="admin-view">
	<header class="view-head">
		<a class="back" href={resolve('/')} aria-label="Back to posts">‹</a>
		<h2>Admin</h2>
	</header>

	{#if error}
		<p class="error">{error}</p>
	{/if}
	{#if message}
		<p class="status" role="status">{message}</p>
	{/if}

	<section>
		<h3>
			LLM drafts to import
			<span class="count">{standalone.length}</span>
			{#if standalone.length > 1}
				<button type="button" class="bulk" disabled={busy != null} onclick={importAll}>Import all</button>
			{/if}
		</h3>
		<p class="hint">
			A <code>.llm.md</code> with no post of its own. Importing creates the post at the same path with an empty body;
			the draft's text appears as its <code>llm</code> version. Opening a draft from the sidebar imports it too.
		</p>
		<div class="rows">
			{#each standalone as draft (draft.path)}
				<div class="drow" class:busy={busy === draft.path || busy === '*'}>
					<span class="what">
						<strong>{draft.path}</strong>
						<small>written {when(draft.mtimeMs)}</small>
					</span>
					<span class="actions">
						<button type="button" disabled={busy != null} onclick={() => importDraft(draft, true)}>Import and open</button>
						<button type="button" disabled={busy != null} onclick={() => importDraft(draft, false)}>Import</button>
					</span>
				</div>
			{:else}
				<p class="empty">Nothing waiting.</p>
			{/each}
		</div>
	</section>

	<section>
		<h3>Feeding a post with a different path <span class="count">{byName.length}</span></h3>
		<p class="hint">
			No post sits at the draft's own path, so its text goes to the one post that shares its name. Import it to
			give it a post of its own; from then on it stops feeding the other one.
		</p>
		<div class="rows">
			{#each byName as draft (draft.path)}
				<div class="drow" class:busy={busy === draft.path}>
					<span class="what">
						<strong>{draft.path}</strong>
						<small>→ {draft.owner} · written {when(draft.mtimeMs)}</small>
					</span>
					<span class="actions">
						<button type="button" disabled={busy != null} onclick={() => importDraft(draft, false)}>Import as its own post</button>
					</span>
				</div>
			{:else}
				<p class="empty">None.</p>
			{/each}
		</div>
	</section>

	<section>
		<h3>Attached to their own post <span class="count">{samePath.length}</span></h3>
		<p class="hint">Each rewrite of the file lands as a new <code>llm</code> version of the post at the same path.</p>
		<div class="rows">
			{#each samePath as draft (draft.path)}
				<div class="drow quiet">
					<span class="what">
						<strong>{draft.path}</strong>
						<small>→ {draft.owner} · written {when(draft.mtimeMs)}</small>
					</span>
				</div>
			{:else}
				<p class="empty">None.</p>
			{/each}
		</div>
	</section>
</div>

<style>
	.admin-view {
		max-width: 560px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 24px;
		padding-top: 4vh;
	}

	.view-head {
		display: flex;
		align-items: baseline;
		gap: 10px;
	}

	.view-head .back {
		color: var(--ink-3);
		font-size: 18px;
		text-decoration: none;
	}

	.view-head h2 {
		font-family: var(--font-display);
		font-size: 26px;
		font-weight: 600;
		letter-spacing: -0.01em;
		margin: 0;
	}

	section {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	h3 {
		align-items: center;
		display: flex;
		font-size: 14px;
		font-weight: 600;
		gap: 8px;
		margin: 0;
	}

	.count {
		color: var(--ink-3);
		font-weight: 400;
	}

	.bulk {
		margin-left: auto;
	}

	.hint {
		color: var(--ink-3);
		font-size: 12.5px;
		margin: 0;
	}

	.hint code {
		font-size: 11.5px;
	}

	.rows {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.drow {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 10px;
		background: var(--bg);
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 10px 12px;
	}

	.drow.quiet {
		background: transparent;
	}

	.drow.busy {
		opacity: 0.5;
	}

	.what {
		display: grid;
		gap: 3px;
		font-size: 13px;
		min-width: 0;
	}

	.what small {
		color: var(--ink-3);
		font-size: 11px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.actions {
		display: flex;
		gap: 6px;
		flex-shrink: 0;
	}

	button {
		border: 1px solid var(--line);
		background: var(--paper);
		border-radius: 999px;
		font: inherit;
		font-size: 11px;
		padding: 4px 10px;
		color: var(--ink-2);
		cursor: pointer;
	}

	button:hover:not(:disabled) {
		background: var(--hover);
	}

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.empty {
		color: var(--ink-3);
		font-size: 13px;
		margin: 0;
		padding: 6px 0;
	}

	.status {
		color: var(--ink-2);
		font-size: 12px;
		margin: 0;
	}

	.error {
		background: color-mix(in srgb, var(--danger) 10%, transparent);
		border-radius: var(--radius);
		color: var(--danger);
		font-size: 12px;
		margin: 0;
		padding: 8px 12px;
	}
</style>
