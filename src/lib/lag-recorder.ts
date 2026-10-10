import { lagBatchMaxEvents, lagThresholdMs, type LagBatch } from './lag.js';

// Long-animation-frame entries are Chromium-only and not in the TS DOM lib yet.
type FrameScript = { invoker: string; sourceURL: string; sourceFunctionName: string; duration: number; forcedStyleAndLayoutDuration: number };
type FrameEntry = PerformanceEntry & { blockingDuration: number; scripts: FrameScript[] };

const flushEveryMs = 10_000;
const ringSize = 200;

type Pending = { path: string; startTime: number };
// Wait before describing a slow input, so the frames and requests around it have been reported.
const settleMs = 1_000;

const pushBounded = <T>(ring: T[], item: T) => {
	ring.push(item);
	if (ring.length > ringSize) ring.shift();
};

const overlaps = (entry: { startTime: number; end: number }, from: number, to: number) =>
	entry.startTime <= to && entry.end >= from;

const fileName = (url: string) => url.split('/').at(-1)?.split('?')[0] ?? url;

const requestPath = (url: string) => {
	const parsed = new URL(url, location.href);
	return `${parsed.pathname}${parsed.search}`.slice(0, 120);
};

export const startLagRecorder = () => {
	const frames: { startTime: number; end: number; entry: FrameEntry }[] = [];
	const requests: { startTime: number; end: number; name: string }[] = [];
	const events: Record<string, unknown>[] = [];
	let inputs = 0;
	let slow = 0;

	const observers: PerformanceObserver[] = [];
	const observe = (type: string, onEntry: (entry: PerformanceEntry) => void) => {
		if (!PerformanceObserver.supportedEntryTypes.includes(type)) return;
		const observer = new PerformanceObserver((list) => list.getEntries().forEach(onEntry));
		observer.observe({ type, buffered: true });
		observers.push(observer);
	};
	observe('long-animation-frame', (entry) =>
		pushBounded(frames, { startTime: entry.startTime, end: entry.startTime + entry.duration, entry: entry as FrameEntry })
	);
	observe('resource', (entry) => {
		if (entry.name.includes('/api/lag')) return;
		pushBounded(requests, { startTime: entry.startTime, end: entry.startTime + entry.duration, name: entry.name });
	});
	const clearResources = () => performance.clearResourceTimings();
	performance.addEventListener('resourcetimingbufferfull', clearResources);

	// Resource timing only reports finished requests, so stalled ones are tracked here.
	// SvelteKit calls window.fetch at request time, so its data reloads pass through too.
	const pending = new Map<number, Pending>();
	let nextRequestId = 0;
	const realFetch = window.fetch;
	const trackedFetch: typeof fetch = (input, init) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		if (url.includes('/api/lag')) return realFetch(input, init);
		const id = nextRequestId++;
		pending.set(id, { path: requestPath(url), startTime: performance.now() });
		return realFetch(input, init).finally(() => pending.delete(id));
	};
	window.fetch = trackedFetch;

	const describe = (inputType: string, start: number, queuedMs: number, paintMs: number, inFlight: Pending[]) => ({
		at: new Date(performance.timeOrigin + start).toISOString(),
		inputType,
		paintMs: Math.round(paintMs),
		queuedMs: Math.round(queuedMs),
		docChars: document.querySelector('.editor-body')?.textContent?.length ?? null,
		inFlight: inFlight.slice(0, 20).map((r) => ({ path: r.path, ageMs: Math.round(start - r.startTime) })),
		requests: requests
			.filter((r) => overlaps(r, start - 2_000, start + paintMs))
			.map((r) => ({ path: requestPath(r.name), startMs: Math.round(r.startTime - start), durationMs: Math.round(r.end - r.startTime) })),
		frames: frames
			.filter((f) => overlaps(f, start - 500, start + paintMs))
			.map(({ entry }) => ({
				startMs: Math.round(entry.startTime - start),
				durationMs: Math.round(entry.duration),
				blockingMs: Math.round(entry.blockingDuration),
				scripts: entry.scripts
					.toSorted((a, b) => b.duration - a.duration)
					.slice(0, 5)
					.map((s) => ({
						invoker: s.invoker,
						source: `${fileName(s.sourceURL)}:${s.sourceFunctionName}`,
						durationMs: Math.round(s.duration),
						layoutMs: Math.round(s.forcedStyleAndLayoutDuration)
					}))
			}))
	});

	const onInput = (event: Event) => {
		const start = event.timeStamp;
		const queuedMs = performance.now() - start;
		const inputType = (event as InputEvent).inputType;
		const inFlight = [...pending.values()];
		inputs += 1;
		requestAnimationFrame(() =>
			setTimeout(() => {
				const paintMs = performance.now() - start;
				if (paintMs < lagThresholdMs) return;
				slow += 1;
				setTimeout(() => {
					if (events.length < lagBatchMaxEvents) events.push(describe(inputType, start, queuedMs, paintMs, inFlight));
				}, settleMs);
			})
		);
	};
	addEventListener('beforeinput', onInput, true);

	const flush = () => {
		if (inputs === 0 && events.length === 0) return;
		const batch: LagBatch = {
			device: `${localStorage.getItem('cms-writer') ?? '?'} · ${navigator.userAgent}`.slice(0, 200),
			editor: localStorage.getItem('xccms:editor') ?? 'milkdown',
			path: location.pathname.slice(0, 200),
			inputs,
			slow,
			events: events.splice(0)
		};
		inputs = 0;
		slow = 0;
		fetch('/api/lag', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(batch),
			keepalive: true
		}).catch(() => {});
	};
	const timer = setInterval(flush, flushEveryMs);
	const flushWhenHidden = () => {
		if (document.hidden) flush();
	};
	document.addEventListener('visibilitychange', flushWhenHidden);

	return () => {
		flush();
		clearInterval(timer);
		document.removeEventListener('visibilitychange', flushWhenHidden);
		removeEventListener('beforeinput', onInput, true);
		if (window.fetch === trackedFetch) window.fetch = realFetch;
		performance.removeEventListener('resourcetimingbufferfull', clearResources);
		observers.forEach((observer) => observer.disconnect());
	};
};
