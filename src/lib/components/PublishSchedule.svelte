<script lang="ts">
	import { refreshAll } from '$app/navigation';
	import { startPoll } from '#lib/poll.js';
	import type { PublishSchedule } from '#lib/types.js';

	let { schedule, drift, stagedCount, blockedReason }: {
		schedule: PublishSchedule | null; drift: string | null; stagedCount: number; blockedReason: string | null;
	} = $props();

	const pollMs = 30_000;

	let when = $state('');
	let rescheduling = $state(false);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let now = $state(Date.now());
	let localZone = $state<string | null>(null);

	let active = $derived(schedule?.state === 'pending' || schedule?.state === 'running' ? schedule : null);
	let chosen = $derived(when ? new Date(when) : null);
	let showForm = $derived(!active || rescheduling);

	function readLocalZone() {
		localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	}

	function pollWhileActive() {
		if (!active) return;
		return startPoll(() => {
			now = Date.now();
			void refreshAll();
		}, pollMs);
	}

	function format(iso: string | Date, timeZone: string) {
		return new Intl.DateTimeFormat(undefined, {
			weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
			hour: 'numeric', minute: '2-digit', timeZone, timeZoneName: 'short'
		}).format(new Date(iso));
	}

	function fromNow(iso: string) {
		const minutes = Math.round((Date.parse(iso) - now) / 60_000);
		const units: [Intl.RelativeTimeFormatUnit, number][] = [['day', 1440], ['hour', 60], ['minute', 1]];
		const [unit, size] = units.find(([, size]) => Math.abs(minutes) >= size) ?? ['minute', 1];
		return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(Math.round(minutes / size), unit);
	}

	function inputValue(date: Date) {
		const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
		return local.toISOString().slice(0, 16);
	}

	async function send(method: 'POST' | 'PATCH' | 'DELETE', body: Record<string, unknown>) {
		busy = true;
		error = null;
		try {
			const res = await fetch('/api/publish/schedule', {
				method,
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			const data = await res.json().catch(() => ({ message: 'Schedule request failed' }));
			if (!res.ok) throw new Error(data.message ?? 'Schedule request failed');
			rescheduling = false;
			when = '';
			await refreshAll();
		} catch (caught) {
			error = caught instanceof Error ? caught.message : String(caught);
		} finally {
			busy = false;
		}
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!chosen || !localZone) return;
		const body = { dueAt: chosen.toISOString(), timeZone: localZone };
		void send(active ? 'PATCH' : 'POST', active ? { ...body, id: active.id } : body);
	}

	function startRescheduling(dueAt: string) {
		rescheduling = true;
		when = inputValue(new Date(dueAt));
	}
</script>

<section class="schedule" aria-labelledby="schedule-heading" {@attach readLocalZone} {@attach pollWhileActive}>
	{#if active?.state === 'running'}
		<h3 id="schedule-heading">Publishing scheduled batch…</h3>
		<p>Started {format(active.startedAt ?? active.dueAt, active.timeZone)}. Manual publishing waits until it finishes.</p>
	{:else if active}
		<h3 id="schedule-heading">
			Scheduled for <time datetime={active.dueAt}>{format(active.dueAt, active.timeZone)}</time>
		</h3>
		<p class="meta">
			{fromNow(active.dueAt)} · {active.timeZone}
			{#if localZone && active.timeZone !== localZone}· {format(active.dueAt, localZone)} here{/if}
		</p>
		<p>
			Publishes exactly the {active.pins.length === 1 ? 'revision' : `${active.pins.length} revisions`} staged when scheduled:
			{active.pins.map((pin) => pin.title).join(', ')}. Editing or restaging one of them blocks the run; the edit is kept.
		</p>
		{#if drift}
			<p class="warn">
				<strong>Will not publish as things stand.</strong> The staged batch changed: {drift}.
				Restage the scheduled revisions, or cancel and schedule the current batch.
			</p>
		{/if}
		{#if !rescheduling}
			<div class="actions">
				<button type="button" disabled={busy} onclick={() => startRescheduling(active.dueAt)}>Reschedule</button>
				<button type="button" class="danger" disabled={busy} onclick={() => send('DELETE', { id: active.id })}>
					Cancel schedule
				</button>
			</div>
		{/if}
	{:else if schedule?.state === 'failed'}
		<h3 id="schedule-heading" class="failed">Scheduled publish failed</h3>
		<p class="meta">
			Due {format(schedule.dueAt, schedule.timeZone)}
			{#if schedule.finishedAt}· stopped {format(schedule.finishedAt, schedule.timeZone)}{/if}
		</p>
		<p>{schedule.error}</p>
		{#if schedule.commit}<p class="meta">Commit {schedule.commit.slice(0, 7)} · not pushed</p>{/if}
		{#if schedule.output?.trim()}
			<details>
				<summary>Output</summary>
				<pre>{schedule.output.slice(-600)}</pre>
			</details>
		{/if}
	{:else if schedule?.state === 'published'}
		<h3 id="schedule-heading" class="ok">Scheduled publish pushed</h3>
		<p class="meta">
			{format(schedule.finishedAt ?? schedule.dueAt, schedule.timeZone)}
			{#if schedule.commit}· commit {schedule.commit.slice(0, 7)}{/if}
			· {schedule.pins.map((pin) => pin.title).join(', ')}
		</p>
		<p class="meta">Pushed to origin. Whether the site build went live is not tracked yet.</p>
	{:else}
		<h3 id="schedule-heading" class="visually-hidden">Schedule</h3>
	{/if}

	{#if showForm}
		<form onsubmit={submit}>
			<label>
				<span>{active ? 'New time' : 'Or publish later at'}</span>
				<input type="datetime-local" required bind:value={when} min={inputValue(new Date(now + 60_000))} onfocus={() => (now = Date.now())} />
			</label>
			<span class="meta">{localZone ?? ''}</span>
			<button type="submit" disabled={busy || !chosen || !localZone || (!active && (!stagedCount || Boolean(blockedReason)))}>
				{active ? 'Save time' : `Schedule ${stagedCount || ''} staged`}
			</button>
			{#if active}
				<button type="button" class="plain" onclick={() => { rescheduling = false; when = ''; }}>Keep current time</button>
			{/if}
		</form>
		{#if chosen && localZone && !Number.isNaN(chosen.getTime())}
			<p class="meta">Publishes {format(chosen, localZone)} · {chosen.toISOString().slice(0, 16).replace('T', ' ')} UTC</p>
		{:else if !active && blockedReason}
			<p class="meta">{blockedReason}</p>
		{/if}
	{/if}

	<div role="status">
		{#if error}<p class="error">{error}</p>{/if}
	</div>
</section>

<style>
	.schedule {
		display: grid;
		gap: 6px;
		font-size: 12px;
	}

	.schedule h3 {
		font-size: 13px;
		margin: 0;
	}

	.schedule p {
		margin: 0;
	}

	.meta {
		color: var(--ink-3);
		font-size: 11.5px;
	}

	.ok {
		color: var(--ok);
	}

	.failed,
	.error {
		color: var(--danger);
	}

	.warn {
		border-left: 3px solid var(--warn);
		padding-left: 8px;
	}

	.actions,
	form {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
	}

	label {
		display: flex;
		gap: 8px;
		align-items: center;
		color: var(--ink-2);
	}

	input {
		background: var(--bg);
		border: 1px solid var(--line);
		border-radius: 8px;
		color: inherit;
		font: inherit;
		padding: 4px 8px;
	}

	button {
		background: var(--hover);
		border: 1px solid var(--line);
		border-radius: 999px;
		color: inherit;
		cursor: pointer;
		font: inherit;
		padding: 3px 11px;
	}

	button:hover:not(:disabled) {
		border-color: var(--ink-3);
	}

	button:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	button.danger {
		color: var(--danger);
	}

	button.plain {
		background: none;
		border: none;
		color: var(--ink-3);
	}

	pre {
		font-size: 11px;
		overflow-x: auto;
		white-space: pre-wrap;
	}

	.visually-hidden {
		clip-path: inset(50%);
		height: 1px;
		overflow: hidden;
		position: absolute;
		width: 1px;
	}
</style>
