<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { startPoll } from '$lib/poll';
	import { isValidWriter } from '$lib/save-rules';
	import { browser } from '$app/environment';
	import { deserialize } from '$app/forms';
	import { TextareaAutosize } from 'runed';
	import MilkdownEditor from './MilkdownEditor.svelte';
	import ReferencePane from './ReferencePane.svelte';
	import { parseFrontmatter, serializeFrontmatter } from '$lib/frontmatter';
	import type { LlmDraft, Post, WriterVersion } from '$lib/types';

	type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';

	let {
		post,
		llmDraft = null,
		versions = null,
		onSaved
	}: { post: Post; llmDraft?: LlmDraft | null; versions?: WriterVersion[] | null; onSaved?: () => void } = $props();

	const initial = untrack(() => parseFrontmatter(post.frontmatter));

	let titleField = $state(initial.title);
	let dateField = $state(initial.date);
	let tagsText = $state(initial.tags.join(', '));
	let publishField = $state(initial.publish);
	let pinField = $state(initial.pin);
	let deleteField = $state(initial.deleteRequested);
	let customField = $state(initial.custom);
	let bodyField = $state(untrack(() => post.body));
	let knownHash = $state(untrack(() => post.contentHash ?? ''));
	const defaultWriter = () => {
		if (/iPhone/.test(navigator.userAgent)) return 'ph';
		if (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1) return 'pad';
		return 'mac';
	};
	const initialWriter = () => {
		if (!browser) return 'mac';
		const stored = localStorage.getItem('cms-writer');
		return stored && isValidWriter(stored) ? stored : defaultWriter();
	};
	let writerName = $state(initialWriter());
	let editingWriter = $state(false);
	let writerDraft = $state('');

	function commitWriter() {
		editingWriter = false;
		const next = writerDraft.trim();
		if (!isValidWriter(next) || next === writerName) return;
		writerName = next;
		localStorage.setItem('cms-writer', next);
	}
	const sessionId = browser
		? (sessionStorage.getItem('cms-session') ??
			(() => {
				const id = crypto.randomUUID().replaceAll('-', '').slice(0, 8);
				sessionStorage.setItem('cms-session', id);
				return id;
			})())
		: 'ssrnoop00';
	let conflictInfo = $state<{ writer: string; currentHash: string; currentFrontmatter: string; currentBody: string } | null>(null);
	let diverged = $state(false);

	type PaneSource = { id: string; body: string; dismissible: boolean };

	let sources = $derived<PaneSource[]>([
		...(llmDraft ? [{ id: 'llm', body: llmDraft.body, dismissible: false }] : []),
		...(versions ?? []).map((v) => ({ id: v.writer, body: v.body, dismissible: true }))
	]);
	let selectedSourceId = $state<string | null>(null);
	let activeSource = $derived(sources.find((s) => s.id === selectedSourceId) ?? sources[0] ?? null);

	async function dismissSource(id: string) {
		const fd = new FormData();
		fd.set('path', post.path);
		fd.set('writer', id);
		const res = await fetch('?/dismissVersion', { method: 'POST', body: fd }).catch(() => null);
		if (!res?.ok) {
			lastError = `Could not dismiss version ${id}`;
			return;
		}
		onSaved?.();
	}

	let tagsInput = $state<HTMLTextAreaElement | undefined>();
	let customInput = $state<HTMLTextAreaElement | undefined>();
	let milkdown = $state<
		| { setContent: (markdown: string) => void; insertMarkdown: (markdown: string, inline?: boolean) => void }
		| undefined
	>();
	let referenceOpen = $state(untrack(() => Boolean(llmDraft) || (versions?.length ?? 0) > 0));

	function insertFromReference(markdown: string, inline: boolean) {
		milkdown?.insertMarkdown(markdown, inline);
		markDirty();
	}

	if (browser) {
		new TextareaAutosize({
			element: () => tagsInput,
			input: () => tagsText,
			styleProp: 'minHeight'
		});

		new TextareaAutosize({
			element: () => customInput,
			input: () => customField,
			styleProp: 'minHeight'
		});

		onDestroy(
			startPoll(async () => {
				if (status !== 'saved' || conflictInfo || diverged) return;
				const res = await fetch(`/api/post?path=${encodeURIComponent(post.path)}`).catch(() => null);
				if (!res?.ok) return;
				const latest = (await res.json()) as { contentHash: string; frontmatter: string; body: string };
				if (latest.contentHash === knownHash) return;
				if (status !== 'saved' || conflictInfo || diverged) return;
				adoptContent(latest);
				onSaved?.();
			}, 5000)
		);
	}

	let status = $state<SaveStatus>('saved');
	let autosaveOn = $state(true);
	let lastError = $state<string | null>(null);
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	let currentTags = $derived(
		tagsText
			.split(/[,\n]/)
			.map((t) => t.trim())
			.filter(Boolean)
	);

	function markDirty() {
		status = 'dirty';
		if (saveTimer) clearTimeout(saveTimer);
		if (!autosaveOn) return;
		saveTimer = setTimeout(save, 1200);
	}

	function onBodyChange(md: string) {
		if (md === bodyField) return;
		bodyField = md;
		markDirty();
	}

	function adoptContent(next: { contentHash: string; frontmatter: string; body: string }) {
		const fields = parseFrontmatter(next.frontmatter);
		titleField = fields.title;
		dateField = fields.date;
		tagsText = fields.tags.join(', ');
		publishField = fields.publish;
		pinField = fields.pin;
		deleteField = fields.deleteRequested;
		customField = fields.custom;
		bodyField = next.body;
		milkdown?.setContent(next.body);
		knownHash = next.contentHash;
		status = 'saved';
		conflictInfo = null;
		diverged = false;
	}

	let saveInFlight = false;

	async function save() {
		if (saveInFlight) {
			if (saveTimer) clearTimeout(saveTimer);
			saveTimer = setTimeout(save, 400);
			return;
		}
		saveInFlight = true;

		try {
			if (saveTimer) {
				clearTimeout(saveTimer);
				saveTimer = null;
			}
			status = 'saving';
			lastError = null;

			const serialized = serializeFrontmatter({
				title: titleField,
				date: dateField,
				tags: currentTags,
				publish: publishField,
				pin: pinField,
				deleteRequested: deleteField,
				custom: customField
			});

			const fd = new FormData();
			fd.set('path', post.path);
			fd.set('frontmatter', serialized);
			fd.set('body', bodyField);
			fd.set('baseHash', knownHash);
			fd.set('writer', writerName);
			fd.set('sessionId', sessionId);

			const res = await fetch('?/save', { method: 'POST', body: fd });
			const result = deserialize(await res.text());

			if (result.type === 'success') {
				const data = result.data as
					| {
							savedHash?: string;
							conflict?: boolean;
							writer?: string;
							currentHash?: string;
							currentFrontmatter?: string;
							currentBody?: string;
					  }
					| undefined;

				if (data?.writer && data.writer !== writerName) writerName = data.writer;

				if (data?.conflict && data.writer && data.currentHash) {
					conflictInfo = {
						writer: data.writer,
						currentHash: data.currentHash,
						currentFrontmatter: data.currentFrontmatter ?? '',
						currentBody: data.currentBody ?? ''
					};
					status = 'saved';
					diverged = true;
					onSaved?.();
					return;
				}

				if (data?.savedHash) knownHash = data.savedHash;
				status = 'saved';
				conflictInfo = null;
				diverged = false;
				onSaved?.();
				return;
			}

			if (result.type === 'failure') {
				const data = result.data as { message?: string; conflict?: boolean } | undefined;
				status = 'error';
				lastError = data?.message ?? 'Save failed';
				return;
			}

			throw new Error(`Unexpected action result: ${result.type}`);
		} catch (err) {
			status = 'error';
			lastError = err instanceof Error ? err.message : String(err);
		} finally {
			saveInFlight = false;
		}
	}

	function toggleAutosave() {
		autosaveOn = !autosaveOn;
		if (autosaveOn && status === 'dirty') {
			if (saveTimer) clearTimeout(saveTimer);
			saveTimer = setTimeout(save, 400);
		}
	}

	function togglePublish() {
		if (publishField) deleteField = false;
		markDirty();
	}

	function toggleDelete() {
		if (deleteField) publishField = false;
		markDirty();
	}

	onDestroy(() => {
		if (saveTimer) clearTimeout(saveTimer);
	});
</script>

<header class="post-head">
	<div class="path">{post.path}</div>
	<div class="status-row">
		{#if post.path.endsWith('.llm.md')}
			<form method="POST" action="?/fork">
				<input type="hidden" name="path" value={post.path} />
				<button class="fork-button">Start your version</button>
			</form>
		{/if}
		{#if sources.length > 0}
			<button
				class="reference-toggle"
				type="button"
				aria-pressed={referenceOpen}
				onclick={() => (referenceOpen = !referenceOpen)}
			>
				Reference
			</button>
		{/if}
		{#if editingWriter}
			<input
				class="writer-chip-input"
				bind:value={writerDraft}
				{@attach (el) => el.focus()}
				onblur={commitWriter}
				onkeydown={(e) => {
					if (e.key === 'Enter') commitWriter();
					if (e.key === 'Escape') editingWriter = false;
				}}
			/>
		{:else}
			<button
				class="writer-chip"
				type="button"
				title="This device writes as '{writerName}' — click to rename"
				onclick={() => {
					writerDraft = writerName;
					editingWriter = true;
				}}
			>
				{writerName}
			</button>
		{/if}
		<button
			class="status-button"
			type="button"
			onclick={() => (autosaveOn ? (status === 'dirty' ? save() : null) : save())}
			disabled={status === 'saving' || (autosaveOn && status !== 'dirty')}
			title={autosaveOn ? `Autosave on · ${status}` : `Autosave off · ${status === 'dirty' ? 'click to save' : status}`}
			class:saved={status === 'saved'}
			class:dirty={status === 'dirty'}
			class:saving={status === 'saving'}
			class:error={status === 'error'}
		>
			<span>
				{status === 'saved'
					? 'Saved'
					: status === 'saving'
						? 'Saving…'
						: status === 'error'
							? 'Retry save'
							: 'Unsaved'}
			</span>
		</button>
		<label class="autosave-toggle" title="Autosave">
			<input type="checkbox" bind:checked={autosaveOn} onchange={toggleAutosave} />
			<span>Auto</span>
		</label>
	</div>
</header>

{#if lastError}
	<p class="error-banner">{lastError}</p>
{/if}

{#if conflictInfo}
	<p class="conflict-banner">
		Changed elsewhere — your text is safe as the <b>{conflictInfo.writer}</b> version.
		<button
			type="button"
			onclick={() =>
				conflictInfo &&
				adoptContent({
					contentHash: conflictInfo.currentHash,
					frontmatter: conflictInfo.currentFrontmatter,
					body: conflictInfo.currentBody
				})}>Load theirs</button
		>
		<button type="button" onclick={() => (conflictInfo = null)}>Keep typing</button>
	</p>
{/if}

<div class="workspace" class:split={referenceOpen && activeSource}>
	{#if referenceOpen && activeSource}
		<div class="reference-stack">
			{#if sources.length > 1 || activeSource.dismissible}
				<div class="source-tabs">
					{#each sources as source (source.id)}
						<button
							type="button"
							class="source-tab"
							class:active={source.id === activeSource.id}
							onclick={() => (selectedSourceId = source.id)}
						>
							{source.id}
						</button>
					{/each}
					{#if activeSource.dismissible}
						<button type="button" class="source-dismiss" onclick={() => activeSource && dismissSource(activeSource.id)}>
							dismiss
						</button>
					{/if}
				</div>
			{/if}
			{#key activeSource.id}
				<ReferencePane label={activeSource.id} body={activeSource.body} userBody={bodyField} onInsert={insertFromReference} />
			{/key}
		</div>
	{/if}

	<div class="draft">
<section class="frontmatter">
	<div class="meta-line">
		<input
			id="title"
			aria-label="Title"
			bind:value={titleField}
			oninput={markDirty}
			placeholder="Untitled"
		/>
		<input
			id="date"
			aria-label="Date"
			bind:value={dateField}
			oninput={markDirty}
			placeholder="YYYY-MM-DD"
			inputmode="numeric"
			pattern="[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]"
			maxlength="10"
		/>

		<label class="icon-toggle" title="Publish">
			<input aria-label="Publish" type="checkbox" bind:checked={publishField} onchange={togglePublish} />
			<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
				<path d="M5 12.5 9.2 17 19 7" />
			</svg>
		</label>

		<label class="icon-toggle" title="Pin">
			<input aria-label="Pin" type="checkbox" bind:checked={pinField} onchange={markDirty} />
			<svg class="pin-outline" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
				<path d="m3 21 4.63-4.631m.005-.005-2.78-2.78c-.954-.953.006-2.996 1.31-3.078 1.178-.075 3.905.352 4.812-.555l2.49-2.49c.617-.618.225-2 .185-2.762-.058-1.016 1.558-2.271 2.415-1.414l4.647 4.648c.86.858-.4 2.469-1.413 2.415-.762-.04-2.145-.432-2.763.185l-2.49 2.49c-.906.907-.48 3.633-.554 4.811-.082 1.305-2.125 2.265-3.08 1.31z" />
			</svg>
			<svg class="pin-solid" width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
				<path d="M14.102 2.664c.628-.416 1.692-.713 2.495.09l4.647 4.648c.806.804.508 1.868.091 2.495a2.95 2.95 0 0 1-.863.85c-.334.213-.756.374-1.211.35a9 9 0 0 1-.658-.071l-.068-.01a9 9 0 0 0-.707-.073c-.504-.025-.698.06-.76.12l-2.49 2.491c-.08.08-.18.258-.256.6-.073.33-.105.736-.113 1.186-.007.432.008.874.024 1.3l.001.047c.015.423.03.855.009 1.194-.065 1.031-.868 1.79-1.658 2.141-.79.35-1.917.437-2.7-.347l-2.25-2.25L3.53 21.53a.75.75 0 1 1-1.06-1.06l4.104-4.105-2.25-2.25c-.783-.784-.697-1.91-.346-2.7.35-.79 1.11-1.593 2.14-1.658.34-.021.772-.006 1.195.009l.047.001c.426.015.868.031 1.3.024.45-.008.856-.04 1.186-.113.342-.076.52-.177.6-.257l2.49-2.49c.061-.061.146-.256.12-.76a9 9 0 0 0-.073-.707l-.009-.068a9 9 0 0 1-.071-.658c-.025-.455.136-.877.348-1.211.216-.34.515-.64.851-.863" />
			</svg>
		</label>

		<form class="queue-form" method="POST" action={post.editingOrder != null ? '?/queueRemove' : '?/queueAdd'}>
			<input type="hidden" name="path" value={post.path} />
			<button
				class="icon-toggle edit-toggle"
				class:queued={post.editingOrder != null}
				title={post.editingOrder != null ? 'Remove from editing queue' : 'Add to editing queue'}
			>
				<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
					<path d="M11 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0" />
					<path d="M12 7a5 5 0 1 0 5 5" />
					<path d="M13 3.055A9 9 0 1 0 20.941 11" />
					<path d="M15 6v3h3l3-3h-3V3zm0 3l-3 3" />
				</svg>
			</button>
		</form>

		<label class="icon-toggle delete-toggle" title="Delete">
			<input aria-label="Delete" type="checkbox" bind:checked={deleteField} onchange={toggleDelete} />
			<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
				<path d="M4 7h16" />
				<path d="M10 11v6" />
				<path d="M14 11v6" />
				<path d="M6 7l1 14h10l1-14" />
				<path d="M9 7V4h6v3" />
			</svg>
		</label>
	</div>

	<div class="tags-line">
		<textarea
			id="tags"
			bind:this={tagsInput}
			bind:value={tagsText}
			oninput={markDirty}
			placeholder="comma-separated tags"
			rows="1"
		></textarea>
	</div>

	<div class="custom-field">
		<textarea
			id="custom"
			bind:this={customInput}
			bind:value={customField}
			oninput={markDirty}
			placeholder="key: value"
			spellcheck="false"
		></textarea>
	</div>
</section>

		<section class="editor-body">
			<MilkdownEditor bind:this={milkdown} value={bodyField} onChange={onBodyChange} />
		</section>
	</div>
</div>

<style>
	.post-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		margin-bottom: 24px;
	}

	.path {
		color: var(--ink-3);
		font-size: 12px;
		font-family: var(--font-mono);
	}

	.status-row {
		display: flex;
		gap: 10px;
		align-items: center;
	}

	.fork-button {
		background: var(--accent);
		border: none;
		border-radius: 6px;
		color: var(--on-accent);
		cursor: pointer;
		font: inherit;
		font-size: 12px;
		font-weight: 600;
		padding: 5px 10px;
	}

	.fork-button:hover {
		background: var(--accent-ink);
	}

	.reference-toggle {
		background: transparent;
		border: none;
		border-radius: 6px;
		color: var(--ink-3);
		cursor: pointer;
		font: inherit;
		font-size: 12px;
		padding: 4px 8px;
	}

	.reference-toggle:hover {
		background: var(--hover);
		color: var(--ink);
	}

	.reference-toggle[aria-pressed='true'] {
		background: var(--hover);
		color: var(--accent-ink);
	}

	.workspace.split {
		display: grid;
		grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
		gap: 36px;
	}

	.reference-stack {
		min-width: 0;
	}

	.source-tabs {
		display: flex;
		gap: 4px;
		margin-bottom: 8px;
	}

	.source-tab {
		background: transparent;
		border: none;
		border-radius: 6px;
		color: var(--ink-3);
		cursor: pointer;
		font: inherit;
		font-size: 12px;
		padding: 3px 9px;
	}

	.source-tab.active {
		background: var(--hover);
		color: var(--accent-ink);
	}

	.source-dismiss {
		background: transparent;
		border: none;
		color: var(--ink-3);
		cursor: pointer;
		font: inherit;
		font-size: 11px;
		margin-left: auto;
		padding: 3px 6px;
	}

	.source-dismiss:hover {
		color: var(--danger);
	}

	@media (max-width: 960px) {
		.workspace.split {
			grid-template-columns: 1fr;
		}
	}

	.writer-chip {
		background: color-mix(in srgb, var(--accent) 10%, transparent);
		border: none;
		border-radius: 5px;
		color: var(--accent-ink);
		cursor: pointer;
		font: 700 11px/1 var(--font-mono);
		padding: 4px 7px;
	}

	.writer-chip-input {
		background: var(--bg);
		border: 1px solid var(--line);
		border-radius: 5px;
		color: var(--ink);
		font: 700 11px/1 var(--font-mono);
		padding: 4px 7px;
		width: 72px;
	}

	.status-button {
		background: transparent;
		border: none;
		color: var(--ink-3);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		font: inherit;
		font-size: 12px;
		padding: 4px 0;
	}

	.status-button.saving {
		color: var(--ink-2);
	}

	.status-button.dirty {
		color: var(--ink-2);
	}

	.status-button.dirty span::before {
		content: '';
		display: inline-block;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--warn);
		margin-right: 6px;
		vertical-align: 1px;
	}

	.status-button.error {
		color: var(--danger);
	}

	.status-button:disabled {
		cursor: default;
	}

	.status-button:not(:disabled):hover {
		color: var(--ink);
	}

	.autosave-toggle {
		display: inline-flex;
		gap: 5px;
		align-items: center;
		font-size: 11px;
		color: var(--ink-3);
		cursor: pointer;
		user-select: none;
	}

	.error-banner {
		background: color-mix(in srgb, var(--danger) 10%, transparent);
		border-radius: var(--radius);
		color: var(--danger);
		font-size: 13px;
		margin: 0 auto 14px;
		max-width: 68ch;
		padding: 8px 12px;
	}

	.conflict-banner {
		background: color-mix(in srgb, var(--warn) 12%, transparent);
		border-radius: var(--radius);
		color: var(--ink);
		font-size: 13px;
		margin: 0 auto 14px;
		max-width: 68ch;
		padding: 8px 12px;
	}

	.conflict-banner button {
		background: transparent;
		border: 1px solid var(--line);
		border-radius: 6px;
		color: var(--ink-2);
		cursor: pointer;
		font: inherit;
		font-size: 12px;
		margin-left: 8px;
		padding: 3px 9px;
	}

	.frontmatter {
		display: grid;
		gap: 8px;
		margin: 0 auto 28px;
		max-width: 68ch;
		width: 100%;
	}

	.meta-line {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
	}

	#date {
		width: 124px;
	}

	.meta-line input,
	.tags-line textarea,
	.custom-field textarea {
		background: transparent;
		border: none;
		border-radius: 6px;
		color: inherit;
		font: inherit;
		min-width: 0;
		resize: none;
	}

	.meta-line input:focus,
	.tags-line textarea:focus,
	.custom-field textarea:focus {
		background: var(--bg);
		outline: none;
	}

	#title {
		flex: 1 0 100%;
		font-family: var(--font-display);
		font-size: 36px;
		font-weight: 600;
		line-height: 1.15;
		letter-spacing: -0.01em;
		padding: 5px 6px;
	}

	#date {
		color: var(--ink-2);
		font-family: var(--font-mono);
		font-size: 13px;
		padding: 6px;
	}

	.icon-toggle {
		border-radius: 7px;
		color: var(--ink-3);
		cursor: pointer;
		display: inline-grid;
		height: 30px;
		place-items: center;
		width: 30px;
	}

	.icon-toggle:hover {
		background: var(--hover);
	}

	.icon-toggle input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}

	.icon-toggle:has(input:checked) {
		background: color-mix(in srgb, var(--ok) 12%, transparent);
		color: var(--ok);
	}

	.delete-toggle:has(input:checked) {
		background: color-mix(in srgb, var(--danger) 10%, transparent);
		color: var(--danger);
	}

	.queue-form {
		display: contents;
	}

	.edit-toggle {
		background: transparent;
		border: none;
		font: inherit;
	}

	.edit-toggle.queued {
		background: color-mix(in srgb, var(--accent) 12%, transparent);
		color: var(--accent-ink);
	}

	.pin-solid,
	.icon-toggle:has(input:checked) .pin-outline {
		display: none;
	}

	.icon-toggle:has(input:checked) .pin-solid {
		display: block;
	}

	.tags-line,
	.custom-field {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
	}

	.tags-line textarea {
		padding: 6px;
	}

	.custom-field textarea {
		font-family: var(--font-mono);
		font-size: 12px;
		min-height: 31px;
		padding: 7px 8px;
	}

	.editor-body {
		min-height: 62vh;
	}

</style>
