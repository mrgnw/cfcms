<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import SegmentCard from '#lib/components/SegmentCard.svelte';

	let { data, form } = $props();

	type RevisionEntry = (typeof data.revisions)[number];

	let headRev = $derived(data.revisions[0].rev);
	let isHead = $derived(data.selected.rev === headRev);
	let labelDraft = $state('');
	let naming = $state(false);

	const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
	const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

	const titleOf = (entry: RevisionEntry) => {
		if (entry.label) return entry.label;
		if (entry.rev === headRev) return 'Current draft';
		if (entry.hash === data.publishedHash) return 'Published version';
		return 'Autosave';
	};

	let groups = $derived(
		Object.entries(Object.groupBy(data.revisions, (entry) => day(entry.savedAt))) as [string, RevisionEntry[]][]
	);

	function startNaming() {
		labelDraft = data.selected.label ?? '';
		naming = true;
	}
</script>

<svelte:head>
	<title>History · {data.post.title} · cms.xcc.es</title>
</svelte:head>

<nav class="crumbs">
	<a href={resolve('/posts/[slug]', { slug: data.post.slug })}>← {data.post.title}</a>
	<span>/ History</span>
</nav>

<div class="history">
	<aside class="rail" aria-label="Post revisions">
		{#each groups as [date, entries] (date)}
			<div class="group-title">{date}</div>
			{#each entries as entry (entry.rev)}
				<a
					class="revision"
					href="?rev={entry.rev}"
					aria-current={entry.rev === data.selected.rev ? 'true' : undefined}
					data-sveltekit-replacestate
					data-sveltekit-reset="false"
				>
					<span class="dot" class:named={entry.label || entry.hash === data.publishedHash}></span>
					<span class="rev-copy">
						<span class="rev-title">{titleOf(entry)}</span>
						<span class="rev-meta">{time(entry.savedAt)} · {entry.writer} · #{entry.rev}</span>
					</span>
				</a>
			{/each}
		{/each}
		<p class="retention">Latest 200 autosaves kept · named versions kept</p>
	</aside>

	<main class="detail">
		<header class="detail-head">
			<div>
				<h2>{titleOf(data.selected)}</h2>
				<div class="meta">
					{day(data.selected.savedAt)} {time(data.selected.savedAt)} · saved by {data.selected.writer} · revision {data.selected.rev}
					{#if data.selected.lines}
						· <em class="add">+{data.selected.lines.added}</em> <em class="del">−{data.selected.lines.deleted}</em>
					{/if}
				</div>
			</div>
			<div class="actions">
				{#if naming}
					<form
						method="POST"
						action="?/labelRevision"
						class="name-form"
						use:enhance={() =>
							async ({ update }) => {
								await update({ reset: false });
								naming = false;
							}}
					>
						<input type="hidden" name="path" value={data.post.path} />
						<input type="hidden" name="rev" value={data.selected.rev} />
						<input
							name="label"
							bind:value={labelDraft}
							maxlength="60"
							placeholder="Before rewriting the ending"
							aria-label="Version name"
							{@attach (el) => el.focus()}
							onkeydown={(event) => event.key === 'Escape' && (naming = false)}
						/>
						<button class="button primary">Save</button>
					</form>
				{:else}
					<button class="button" type="button" onclick={startNaming}>
						{data.selected.label ? 'Rename' : isHead ? 'Save checkpoint' : 'Name version'}
					</button>
				{/if}
				{#if !isHead}
					<form
						method="POST"
						action="?/restoreRevision"
						onsubmit={(event) => {
							if (!confirm('Restore this version? It becomes a new current revision; later saves stay in history.'))
								event.preventDefault();
						}}
					>
						<input type="hidden" name="path" value={data.post.path} />
						<input type="hidden" name="rev" value={data.selected.rev} />
						<button class="button primary">Restore this version</button>
					</form>
				{/if}
			</div>
		</header>

		{#if form?.message}
			<p class="error-banner">{form.message}</p>
		{/if}

		{#if data.selected.segments?.length}
			<section class="segments" aria-label="Changes since the previous revision">
				{#each data.selected.segments as segment, index (index)}
					<SegmentCard
						kind={segment.kind}
						label={segment.kind}
						theirs={segment.kind === 'removed' ? null : segment.theirs}
						yours={segment.kind === 'removed' ? segment.yours : segment.kind === 'modified' ? `was: ${segment.yours}` : null}
						strike={segment.kind === 'removed'}
					/>
				{/each}
			</section>
		{/if}

		<article class="preview" aria-label="Revision preview">
			<h3>{data.selected.title}</h3>
			{#each data.selected.blocks as block, index (index)}
				<p>{block}</p>
			{:else}
				<p class="empty">Empty body.</p>
			{/each}
		</article>
	</main>
</div>

<style>
	.crumbs {
		color: var(--ink-3);
		display: flex;
		gap: 6px;
		font-size: 13px;
		margin-bottom: 20px;
	}

	.crumbs a {
		color: var(--ink-2);
		text-decoration: none;
	}

	.crumbs a:hover {
		color: var(--ink);
	}

	.history {
		display: grid;
		grid-template-columns: 260px minmax(0, 1fr);
		gap: 32px;
	}

	.rail {
		border-right: 1px solid var(--line);
		max-height: calc(100vh - 120px);
		overflow-y: auto;
		position: sticky;
		top: 20px;
	}

	.group-title {
		color: var(--ink-3);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.08em;
		padding: 14px 14px 6px;
		text-transform: uppercase;
	}

	.revision {
		border-left: 3px solid transparent;
		color: var(--ink);
		display: flex;
		gap: 10px;
		padding: 7px 12px;
		text-decoration: none;
	}

	.revision:hover {
		background: var(--hover);
	}

	.revision[aria-current='true'] {
		background: color-mix(in srgb, var(--accent) 9%, transparent);
		border-left-color: var(--accent);
	}

	.dot {
		background: var(--line);
		border-radius: 50%;
		flex: none;
		height: 8px;
		margin-top: 6px;
		width: 8px;
	}

	.dot.named {
		background: var(--accent);
	}

	.rev-copy {
		min-width: 0;
	}

	.rev-title {
		display: block;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.rev-meta {
		color: var(--ink-2);
		display: block;
		font-size: 12px;
	}

	.retention {
		border-top: 1px solid var(--line);
		color: var(--ink-3);
		font-size: 12px;
		margin: 16px 14px 0;
		padding-top: 12px;
	}

	.detail {
		min-width: 0;
	}

	.detail-head {
		align-items: start;
		border-bottom: 1px solid var(--line);
		display: flex;
		gap: 20px;
		justify-content: space-between;
		padding-bottom: 18px;
	}

	h2 {
		font-size: 22px;
		letter-spacing: -0.02em;
		margin: 0 0 6px;
	}

	.meta {
		color: var(--ink-2);
		font-size: 12px;
	}

	.actions,
	.name-form {
		align-items: center;
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		justify-content: flex-end;
	}

	.name-form input {
		background: var(--bg);
		border: 1px solid var(--line);
		border-radius: 7px;
		color: var(--ink);
		font: inherit;
		padding: 6px 9px;
		width: 240px;
	}

	.button {
		background: transparent;
		border: 1px solid var(--line);
		border-radius: 7px;
		color: var(--ink);
		cursor: pointer;
		font: inherit;
		padding: 6px 11px;
		white-space: nowrap;
	}

	.button:hover {
		background: var(--hover);
	}

	.button.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--on-accent);
		font-weight: 600;
	}

	.error-banner {
		background: color-mix(in srgb, var(--danger) 10%, transparent);
		border-radius: var(--radius);
		color: var(--danger);
		font-size: 13px;
		margin: 14px 0 0;
		padding: 8px 12px;
	}

	.preview {
		font: 17px/1.7 var(--font-display);
		margin: 0 auto;
		max-width: 68ch;
		padding: 32px 0 80px;
	}

	.preview h3 {
		font-size: 32px;
		font-weight: 600;
		letter-spacing: -0.02em;
		line-height: 1.2;
		margin: 0 0 24px;
	}

	.preview p {
		margin: 0 0 20px;
		white-space: pre-wrap;
	}

	.segments {
		margin: 20px auto 0;
		max-width: 68ch;
	}

	.add,
	.del {
		font-style: normal;
	}

	.add {
		color: var(--ok);
	}

	.del {
		color: var(--danger);
	}

	.empty {
		color: var(--ink-3);
	}

	@media (max-width: 720px) {
		.history {
			display: block;
		}

		.rail {
			border-bottom: 1px solid var(--line);
			border-right: 0;
			max-height: 40vh;
			margin-bottom: 20px;
			position: static;
		}

		.detail-head {
			display: block;
		}

		.actions {
			justify-content: flex-start;
			margin-top: 14px;
		}
	}
</style>
