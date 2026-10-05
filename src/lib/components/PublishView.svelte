<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { PendingChange, PublishData } from '$lib/types';

	let { changes, lastPublishedAt }: { changes: PendingChange[]; lastPublishedAt: string | null } = $props();

	let publishing = $state(false);
	let result = $state<PublishData | null>(null);
	let error = $state<string | null>(null);

	let staged = $derived(changes.filter((change) => change.staged));
	let stageable = $derived(changes.filter((change) => !change.blocked));

	let totals = $derived({
		added: changes.reduce((sum, change) => sum + (change.added ?? 0), 0),
		deleted: changes.reduce((sum, change) => sum + (change.deleted ?? 0), 0)
	});

	function scaleWord(change: PendingChange) {
		if (change.status === 'ready') return 'new';
		if (change.status === 'unpublish' || change.status === 'delete') return '';
		if (change.added == null || change.deleted == null) return '';
		const touched = change.added + change.deleted;
		if (touched <= 8) return 'typos';
		return 'reworked';
	}

	function barSegments(change: PendingChange) {
		if (change.status === 'ready') return { add: 100, del: 0 };
		const added = change.added ?? 0;
		const deleted = change.deleted ?? 0;
		const touched = added + deleted;
		if (!touched) return { add: 0, del: 0 };
		const span = Math.min(100, Math.round((touched / 60) * 100));
		return {
			add: Math.round((added / touched) * span),
			del: Math.round((deleted / touched) * span)
		};
	}

	async function setStaged(paths: string[], wanted: boolean) {
		error = null;
		const responses = await Promise.all(
			paths.map((path) => {
				const fd = new FormData();
				fd.set('path', path);
				return fetch(wanted ? '?/stage' : '?/unstage', { method: 'POST', body: fd });
			})
		);
		const outcomes = await Promise.all(responses.map((res) => res.json().catch(() => ({ type: 'error' }))));
		const refused = paths.filter((_, index) => outcomes[index].type !== 'success');
		if (refused.length) error = `Not staged: ${refused.join(', ')}`;
		await invalidateAll();
	}

	async function resolveSite(path: string, choice: 'mine' | 'theirs') {
		error = null;
		const fd = new FormData();
		fd.set('path', path);
		fd.set('choice', choice);
		const res = await fetch('?/resolveSite', { method: 'POST', body: fd });
		const outcome = await res.json().catch(() => ({ type: 'error' }));
		if (outcome.type !== 'success') error = `Could not resolve ${path}`;
		await invalidateAll();
	}

	async function runPublish() {
		publishing = true;
		error = null;
		result = null;
		try {
			const res = await fetch('/publish', { method: 'POST' });
			const data = await res.json();
			if (!res.ok) {
				if (Array.isArray(data.results)) result = data;
				throw new Error(data.message ?? 'Publish failed');
			}
			result = data;
			await invalidateAll();
		} catch (caught) {
			error = caught instanceof Error ? caught.message : String(caught);
		} finally {
			publishing = false;
		}
	}

	function outputLinks(output: string) {
		return Array.from(
			new Set(
				output.match(/https:\/\/[^\s)]+\.workers\.dev[^\s)]*|https:\/\/[^\s)]+\.pages\.dev[^\s)]*/g) ?? []
			)
		);
	}
</script>

<div class="publish-view">
	<header class="view-head">
		<a class="back" href={resolve('/')} aria-label="Back to posts">‹</a>
		<h2>Publish</h2>
		<span class="summary">
			{changes.length} pending
			{#if totals.added || totals.deleted}
				· <em class="add">+{totals.added}</em> <em class="del">−{totals.deleted}</em>
			{/if}
		</span>
	</header>

	<div class="changes">
		{#if changes.length}
			<div class="stage-all">
				<span>
					{staged.length} of {changes.length} staged for next publish
					{#if stageable.length < changes.length}· {changes.length - stageable.length} edited on the site too{/if}
				</span>
				<button
					type="button"
					disabled={!stageable.length}
					onclick={() => setStaged(stageable.map((change) => change.path), staged.length !== stageable.length)}
				>
					{stageable.length && staged.length === stageable.length ? 'Unstage all' : 'Stage all'}
				</button>
			</div>
		{/if}
		{#each changes as change (change.path)}
			{@const bar = barSegments(change)}
			<div class="change-row" class:staged={change.staged} class:blocked={change.blocked}>
				<input
					type="checkbox"
					aria-label="Stage {change.title} for next publish"
					checked={change.staged}
					disabled={change.blocked}
					title={change.blocked ? 'Edited on the site and in the CMS: resolve first' : undefined}
					onchange={() => setStaged([change.path], !change.staged)}
				/>
				<a class="change-link" href={resolve(`/?post=${encodeURIComponent(change.path)}`)}>
					<span class="title">{change.title} <span class="date">{change.date}</span></span>
					<span class="right">
						{#if change.status === 'unpublish' || change.status === 'delete'}
							<span class="badge">{change.status === 'delete' ? 'remove' : 'unpublish'}</span>
						{/if}
						{#if change.blocked}
							<span class="badge site">site version</span>
						{/if}
						<span class="bar" aria-hidden="true">
							{#if bar.add}<i class="add" style:width="{bar.add}%"></i>{/if}
							{#if bar.del}<i class="del" style:width="{bar.del}%"></i>{/if}
						</span>
					</span>
					<span class="delta">
						{#if change.status === 'ready'}
							<em class="add">+{change.words} words</em>
						{:else if change.added != null && change.deleted != null}
							<em class="add">+{change.added}</em>
							<em class="del">−{change.deleted}</em>
							{#if scaleWord(change)}· {scaleWord(change)}{/if}
						{:else}
							no baseline to diff
						{/if}
						· {change.blocked ? 'edited on the site too' : change.staged ? 'next' : 'ready'}
					</span>
				</a>
				{#if change.blocked}
					<span class="resolve">
						<button type="button" onclick={() => resolveSite(change.path, 'mine')}>keep draft</button>
						<button type="button" onclick={() => resolveSite(change.path, 'theirs')}>use site text</button>
						<a href={resolve(`/?post=${encodeURIComponent(change.path)}`)}>compare</a>
					</span>
				{/if}
			</div>
		{:else}
			<p class="empty">Nothing pending — everything live matches the content files.</p>
		{/each}
	</div>

	<button class="publish-btn" type="button" onclick={runPublish} disabled={publishing || !staged.length}>
		{publishing
			? 'Publishing…'
			: staged.length
				? `Publish ${staged.length} staged ${staged.length === 1 ? 'change' : 'changes'}`
				: 'Nothing staged'}
	</button>

	{#if lastPublishedAt}
		<p class="note">last published {new Date(lastPublishedAt).toLocaleString()}</p>
	{/if}

	{#if result}
		<section class="result" class:ok={result.ok}>
			<h3>{result.ok ? 'Published' : 'Publish errored'}</h3>
			{#each result.results as target (target.name)}
				<details open={!target.ok}>
					<summary>
						<span>{target.name}</span>
						<em>{target.ok ? `ok · ${(target.durationMs / 1000).toFixed(1)}s` : 'failed'}</em>
					</summary>
					{#if outputLinks(target.output).length}
						<div class="links">
							{#each outputLinks(target.output) as link (link)}
								<a href={link} target="_blank" rel="noreferrer">{link}</a>
							{/each}
						</div>
					{/if}
					{#if !target.ok && target.output.trim()}
						<pre class="output-tail">{target.output.slice(-600)}</pre>
					{/if}
				</details>
			{/each}
		</section>
	{:else if error}
		<p class="error">{error}</p>
	{/if}
</div>

<style>
	.publish-view {
		max-width: 560px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 16px;
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

	.summary {
		color: var(--ink-2);
		font-size: 13px;
	}

	.summary em,
	.delta em {
		font-style: normal;
	}

	.add {
		color: var(--ok);
	}

	.del {
		color: var(--danger);
	}

	.changes {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.stage-all {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		color: var(--ink-3);
		font-size: 11.5px;
		padding: 0 2px;
	}

	.stage-all button {
		background: none;
		border: none;
		color: var(--accent-ink);
		cursor: pointer;
		font: inherit;
		font-size: 11.5px;
		padding: 0;
	}

	.change-row {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 10px;
		align-items: center;
		background: var(--bg);
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 10px 12px;
		font-size: 13px;
	}

	.change-row.staged {
		border-color: var(--accent);
	}

	.change-row:hover {
		border-color: var(--ink-3);
	}

	.change-row input {
		accent-color: var(--accent);
		margin: 0;
	}

	.change-row.blocked {
		border-style: dashed;
	}

	.resolve {
		grid-column: 2;
		display: flex;
		gap: 6px;
		align-items: baseline;
		font-size: 11.5px;
	}

	.resolve button {
		background: var(--hover);
		border: 1px solid var(--line);
		border-radius: 999px;
		color: inherit;
		cursor: pointer;
		font: inherit;
		font-size: 11.5px;
		padding: 2px 9px;
	}

	.resolve button:hover {
		border-color: var(--ink-3);
	}

	.resolve a {
		color: var(--ink-3);
		margin-left: auto;
	}

	.badge.site {
		background: color-mix(in srgb, var(--warn) 16%, transparent);
		color: var(--warn);
	}

	.stage-all button:disabled {
		color: var(--ink-3);
		cursor: not-allowed;
	}

	.change-link {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 4px 10px;
		color: inherit;
		text-decoration: none;
	}

	.title {
		font-weight: 600;
	}

	.date {
		color: var(--ink-3);
		font-size: 11px;
		font-weight: 400;
	}

	.right {
		grid-row: span 2;
		display: grid;
		gap: 5px;
		justify-items: end;
		align-content: center;
	}

	.badge {
		font-size: 10px;
		font-weight: 650;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		border-radius: 999px;
		padding: 2px 8px;
		background: color-mix(in srgb, var(--danger) 12%, transparent);
		color: var(--danger);
	}

	.delta {
		color: var(--ink-3);
		font-size: 11px;
		display: flex;
		gap: 5px;
	}

	.bar {
		display: flex;
		gap: 1px;
		height: 5px;
		width: 54px;
		border-radius: 3px;
		overflow: hidden;
		background: var(--hover);
	}

	.bar i {
		display: block;
		height: 100%;
	}

	.bar i.add {
		background: var(--ok);
	}

	.bar i.del {
		background: var(--danger);
	}

	.publish-btn {
		background: var(--accent);
		border: none;
		border-radius: var(--radius);
		color: var(--on-accent);
		cursor: pointer;
		font: inherit;
		font-size: 13px;
		font-weight: 600;
		padding: 11px;
	}

	.publish-btn:hover:not(:disabled) {
		background: var(--accent-ink);
	}

	.publish-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.note {
		color: var(--ink-3);
		font-size: 11.5px;
		text-align: center;
		margin: -6px 0 0;
	}

	.empty {
		color: var(--ink-3);
		font-size: 13px;
		text-align: center;
		padding: 18px;
		margin: 0;
	}

	.result {
		border-left: 3px solid var(--danger);
		display: grid;
		gap: 8px;
		padding-left: 10px;
		font-size: 12px;
	}

	.result.ok {
		border-color: var(--ok);
	}

	.result h3 {
		margin: 0;
		font-size: 13px;
	}

	.result details {
		background: var(--bg);
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 6px 8px;
	}

	.result summary {
		cursor: pointer;
		display: flex;
		justify-content: space-between;
		font-size: 12px;
	}

	.result summary em {
		font-style: normal;
		color: var(--danger);
	}

	.result.ok summary em {
		color: var(--ok);
	}

	.links {
		display: grid;
		gap: 4px;
		margin-top: 6px;
	}

	.links a {
		color: var(--accent-ink);
		font-size: 11px;
		word-break: break-all;
	}

	.output-tail {
		background: var(--paper);
		border-radius: 6px;
		color: var(--ink-2);
		font-family: var(--font-mono);
		font-size: 10.5px;
		margin: 6px 0 0;
		max-height: 160px;
		overflow: auto;
		padding: 6px 8px;
		white-space: pre-wrap;
		word-break: break-word;
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
