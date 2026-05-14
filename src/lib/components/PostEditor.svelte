<script lang="ts">
	import { untrack } from 'svelte';
	import { TextareaAutosize } from 'runed';
	import MilkdownEditor from './MilkdownEditor.svelte';
	import { parseFrontmatter, serializeFrontmatter } from '$lib/frontmatter';

	type Post = {
		path: string;
		title: string;
		frontmatter: string;
		body: string;
		publish?: boolean;
	};

	type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';

	let { post, onSaved }: { post: Post; onSaved?: () => void } = $props();

	const initial = untrack(() => parseFrontmatter(post.frontmatter));

	let titleField = $state(initial.title);
	let dateField = $state(initial.date);
	let tagsText = $state(initial.tags.join(', '));
	let publishField = $state(initial.publish);
	let pinField = $state(initial.pin);
	let customField = $state(initial.custom);
	let bodyField = $state(untrack(() => post.body));
	let tagsInput = $state<HTMLTextAreaElement | undefined>();
	let customInput = $state<HTMLTextAreaElement | undefined>();

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

	async function save() {
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
			custom: customField
		});

		const fd = new FormData();
		fd.set('path', post.path);
		fd.set('frontmatter', serialized);
		fd.set('body', bodyField);

		try {
			const res = await fetch('?/save', { method: 'POST', body: fd });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			status = 'saved';
			onSaved?.();
		} catch (err) {
			status = 'error';
			lastError = err instanceof Error ? err.message : String(err);
		}
	}

	function toggleAutosave() {
		autosaveOn = !autosaveOn;
		if (autosaveOn && status === 'dirty') {
			if (saveTimer) clearTimeout(saveTimer);
			saveTimer = setTimeout(save, 400);
		}
	}
</script>

<header class="post-head">
	<div class="path">{post.path}</div>
	<div class="status-row">
		<button
			class="status-icon"
			type="button"
			onclick={() => (autosaveOn ? (status === 'dirty' ? save() : null) : save())}
			disabled={status === 'saving' || (autosaveOn && status !== 'dirty')}
			title={autosaveOn ? `Autosave on · ${status}` : `Autosave off · ${status === 'dirty' ? 'click to save' : status}`}
			class:saved={status === 'saved'}
			class:dirty={status === 'dirty'}
			class:saving={status === 'saving'}
			class:error={status === 'error'}
		>
			{#if status === 'saving'}
				<svg width="14" height="14" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="10 30"><animateTransform attributeName="transform" type="rotate" from="0 8 8" to="360 8 8" dur="0.8s" repeatCount="indefinite" /></circle></svg>
			{:else if status === 'error'}
				<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1 1 14h14L8 1zm0 5v4M8 12v.5" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" /></svg>
			{:else if status === 'dirty'}
				<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="3.5" /></svg>
			{:else}
				<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8.5l3 3 7-7" stroke-linecap="round" stroke-linejoin="round" /></svg>
			{/if}
			<span>
				{status === 'saved' ? 'Saved' : status === 'dirty' ? (autosaveOn ? 'Saving soon' : 'Save') : status === 'saving' ? 'Saving' : 'Error'}
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

<section class="frontmatter">
	<div class="field">
		<label for="title">Title</label>
		<input id="title" bind:value={titleField} oninput={markDirty} />
	</div>

	<div class="row">
		<div class="field">
			<label for="date">Date</label>
			<input id="date" type="date" bind:value={dateField} oninput={markDirty} />
		</div>

		<label class="check">
			<input type="checkbox" bind:checked={publishField} onchange={markDirty} />
			<span>Publish</span>
		</label>

		<label class="check">
			<input type="checkbox" bind:checked={pinField} onchange={markDirty} />
			<span>Pin</span>
		</label>
	</div>

	<div class="field">
		<label for="tags">Tags</label>
		<textarea
			id="tags"
			bind:this={tagsInput}
			bind:value={tagsText}
			oninput={markDirty}
			placeholder="comma, separated, tags"
			rows="1"
		></textarea>
		{#if currentTags.length}
			<div class="chips">
				{#each currentTags as tag (tag)}
					<span class="chip">{tag}</span>
				{/each}
			</div>
		{/if}
	</div>

	<details>
		<summary>Custom frontmatter</summary>
		<textarea
			bind:this={customInput}
			bind:value={customField}
			oninput={markDirty}
			placeholder="key: value"
			spellcheck="false"
		></textarea>
	</details>
</section>

<section class="editor-body">
	<MilkdownEditor value={bodyField} onChange={onBodyChange} />
</section>

<style>
	.post-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		margin-bottom: 16px;
		padding-bottom: 10px;
		border-bottom: 1px solid #e8e1d6;
	}

	.path {
		color: #8a7f70;
		font-size: 12px;
		font-family: 'SFMono-Regular', Consolas, monospace;
	}

	.status-row {
		display: flex;
		gap: 8px;
		align-items: center;
	}

	.status-icon {
		background: transparent;
		border: 1px solid #d8d0c2;
		border-radius: 999px;
		color: #5a5148;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font: inherit;
		font-size: 12px;
		padding: 5px 10px;
	}

	.status-icon.saved {
		color: #3c7a44;
	}

	.status-icon.dirty {
		color: #a47a1a;
		border-color: #d6c089;
	}

	.status-icon.saving {
		color: #5a5148;
	}

	.status-icon.error {
		color: #a43b2f;
		border-color: #d8a89e;
	}

	.status-icon:disabled {
		cursor: default;
	}

	.status-icon:not(:disabled):hover {
		background: #f0ebe1;
	}

	.autosave-toggle {
		display: inline-flex;
		gap: 5px;
		align-items: center;
		font-size: 12px;
		color: #5a5148;
		cursor: pointer;
		user-select: none;
	}

	.error-banner {
		background: #fbe9e6;
		border: 1px solid #d8a89e;
		border-radius: 8px;
		color: #8a463c;
		font-size: 13px;
		margin: 0 0 14px;
		padding: 8px 10px;
	}

	.frontmatter {
		display: grid;
		gap: 12px;
		margin-bottom: 24px;
		padding: 14px;
		background: #fffdf8;
		border: 1px solid #e8e1d6;
		border-radius: 10px;
	}

	.field {
		display: grid;
		gap: 4px;
	}

	.field label {
		color: #8a7f70;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.field input,
	.field textarea {
		background: transparent;
		border: 1px solid transparent;
		border-bottom: 1px solid #e8e1d6;
		border-radius: 0;
		color: inherit;
		font: inherit;
		padding: 6px 2px;
		width: 100%;
		resize: none;
	}

	.field input:focus,
	.field textarea:focus {
		outline: none;
		border-bottom-color: #27211b;
	}

	#title {
		font-size: 22px;
		font-weight: 600;
		letter-spacing: -0.02em;
	}

	.row {
		display: flex;
		gap: 18px;
		align-items: end;
		flex-wrap: wrap;
	}

	.row .field {
		flex: 0 0 auto;
	}

	#date {
		width: 150px;
	}

	.check {
		display: inline-flex;
		gap: 5px;
		align-items: center;
		font-size: 13px;
		color: #5a5148;
		cursor: pointer;
		padding-bottom: 8px;
	}

	.chips {
		display: flex;
		gap: 5px;
		flex-wrap: wrap;
		margin-top: 6px;
	}

	.chip {
		background: #f0ebe1;
		border-radius: 999px;
		color: #5a5148;
		font-size: 11px;
		padding: 2px 9px;
	}

	details summary {
		color: #8a7f70;
		cursor: pointer;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		padding: 4px 0;
	}

	details textarea {
		background: #f4f1eb;
		border: 1px solid #e8e1d6;
		border-radius: 6px;
		font-family: 'SFMono-Regular', Consolas, monospace;
		font-size: 12px;
		margin-top: 6px;
		padding: 8px;
		width: 100%;
		resize: none;
	}

	.editor-body {
		min-height: 60vh;
	}
</style>
