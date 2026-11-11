// Measures per-keystroke latency in both body editors against a sandbox server.
// Usage: node analysis/editor-lag.mjs <baseUrl> <slug> <editor> <cpuRate> <seconds> <latencyMs> [--trace out.json]
// latencyMs is applied per fetch with 0.5x-3x jitter, to mimic a phone on a tunnel.
// Requires playwright to resolve from the repo (pnpm add -D playwright). ORIGIN overrides the Origin sent with POSTs.
// BROWSER=webkit runs Safari's engine; it has no CPU throttling or long-animation-frame data.
import { chromium, webkit } from 'playwright';
import { writeFileSync } from 'node:fs';

const [baseUrl, slug, editor, cpuRateText, secondsText, latencyText, traceFlag, tracePath] = process.argv.slice(2);
const cpuRate = Number(cpuRateText);
const seconds = Number(secondsText);
const latencyMs = Number(latencyText);
// STALL_MS freezes every fetch for that long, starting 8s into typing, like a tunnel hiccup.
const stallMs = Number(process.env.STALL_MS ?? 0);
// NAV_FIRST=N visits N other posts through the sidebar before typing, like a tab open all day.
const navFirst = Number(process.env.NAV_FIRST ?? 0);
let stallStart = Infinity;
const keyDelayMs = 90;
const pauseMs = 1600;
const sentence = 'The quick brown fox jumps over the lazy dog while we keep typing. ';

const engine = process.env.BROWSER === 'webkit' ? webkit : chromium;
const browser = await engine.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
await context.addInitScript((kind) => {
	localStorage.setItem('cfcms:editor', kind);
	localStorage.setItem('cfcms:aragonite-mode', 'live');
	const keys = [];
	const frames = [];
	const net = [];
	window.__lag = { keys, frames, net };

	addEventListener(
		'keydown',
		(e) => {
			const start = e.timeStamp;
			const handlerStart = performance.now();
			requestAnimationFrame(() =>
				setTimeout(() => keys.push({ t: start, queued: handlerStart - start, toPaint: performance.now() - start }))
			);
		},
		true
	);

	if (PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')) new PerformanceObserver((list) => {
		for (const f of list.getEntries()) {
			frames.push({
				t: f.startTime,
				duration: f.duration,
				blocking: f.blockingDuration,
				style: f.styleAndLayoutStart ? f.startTime + f.duration - f.styleAndLayoutStart : 0,
				scripts: f.scripts.map((s) => ({
					invoker: s.invoker,
					source: `${s.sourceURL.split('/').at(-1)}:${s.sourceFunctionName}`,
					duration: Math.round(s.duration),
					layout: Math.round(s.forcedStyleAndLayoutDuration)
				}))
			});
		}
	}).observe({ type: 'long-animation-frame', buffered: true });

	const realFetch = window.fetch;
	let inFlight = 0;
	window.fetch = async (input, init) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		const t = performance.now();
		inFlight += 1;
		const concurrent = inFlight;
		try {
			const res = await realFetch(input, init);
			await res.clone().text();
			return res;
		} finally {
			inFlight -= 1;
			net.push({ t, end: performance.now(), concurrent, url: url.replace(location.origin, '').slice(0, 60) });
		}
	};
}, editor);

// A build started with ORIGIN set rejects form actions from any other Origin, so send the one it was built for.
const origin = process.env.ORIGIN ?? new URL(baseUrl).origin;
await context.route(() => true, async (route) => {
	const request = route.request();
	if (request.resourceType() !== 'fetch') return route.continue();
	if (latencyMs > 0) await new Promise((done) => setTimeout(done, latencyMs * (0.5 + Math.random() * 2.5)));
	const now = Date.now();
	if (now >= stallStart && now < stallStart + stallMs) await new Promise((done) => setTimeout(done, stallStart + stallMs - now));
	if (request.method() !== 'POST') return route.continue();
	const response = await route.fetch({ headers: { ...request.headers(), origin } });
	return route.fulfill({ response });
});

const page = await context.newPage();
const cdp = engine === chromium ? await context.newCDPSession(page) : null;
await page.goto(`${baseUrl}/posts/${slug}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const domCounters = async () => {
	if (!cdp) return null;
	await cdp.send('HeapProfiler.collectGarbage');
	const counters = await cdp.send('Memory.getDOMCounters');
	const heap = await cdp.send('Runtime.getHeapUsage');
	return { nodes: counters.nodes, listeners: counters.jsEventListeners, heapMb: Math.round(heap.usedSize / 1e6) };
};
const memoryBefore = await domCounters();
if (navFirst > 0) {
	const hrefs = await page.locator('aside.sidebar a[href^="/posts/"]').evaluateAll((links) => [...new Set(links.map((a) => a.getAttribute('href')))]);
	const others = hrefs.filter((href) => href !== `/posts/${slug}`);
	for (let i = 0; i < navFirst; i += 1) {
		await page.locator(`aside.sidebar a[href="${others[i % others.length]}"]`).first().click();
		await page.waitForTimeout(700);
	}
	await page.locator(`aside.sidebar a[href="/posts/${slug}"]`).first().click();
	await page.waitForTimeout(1500);
}
const memoryAfterNav = await domCounters();

const host = editor === 'aragonite' ? '.aragonite-host' : '.milkdown-host';
// Aragonite virtualizes long documents, so the last rendered block is not the document end.
const paragraph = editor === 'aragonite' ? `${host} .paragraph-block` : `${host} .ProseMirror > p`;
const editable = page.locator(paragraph).first();
await editable.click();
// No End/Enter: in a long Aragonite document End scrolls to the bottom and virtualization unmounts the focused block.
await page.waitForTimeout(500);
await page.evaluate(() => {
	window.__lag.keys.length = 0;
	window.__lag.frames.length = 0;
	window.__lag.net.length = 0;
});

// SECOND_TAB=1 opens the same post in another browser context, like a second device left open.
let second = null;
if (process.env.SECOND_TAB === '1') {
	const otherContext = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
	await otherContext.addInitScript(() => {
		window.__frames = [];
		window.__requests = 0;
		const realFetch = window.fetch;
		window.fetch = (...args) => {
			window.__requests += 1;
			return realFetch(...args);
		};
		new PerformanceObserver((list) => {
			for (const f of list.getEntries()) window.__frames.push(f.duration);
		}).observe({ type: 'long-animation-frame', buffered: true });
	});
	second = await otherContext.newPage();
	await second.goto(`${baseUrl}/posts/${slug}`, { waitUntil: 'networkidle' });
	await page.bringToFront();
	await editable.click();
}

if (cdp && cpuRate > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
if (traceFlag === '--trace') await browser.startTracing(page, { path: tracePath, screenshots: false });

stallStart = stallMs > 0 ? Date.now() + 8000 : Infinity;
const deadline = Date.now() + seconds * 1000;
while (Date.now() < deadline) {
	await page.keyboard.type(sentence, { delay: keyDelayMs });
	await page.waitForTimeout(pauseMs);
}
await page.waitForTimeout(2500 + latencyMs * 3);

if (traceFlag === '--trace') await browser.stopTracing();
await cdp?.send('Emulation.setCPUThrottlingRate', { rate: 1 });

const data = await page.evaluate(() => window.__lag);
const secondTab = second
	? await second.evaluate(() => ({ requests: window.__requests, longFrames: window.__frames.length, longFrameMaxMs: Math.round(Math.max(0, ...window.__frames)) }))
	: null;
const status = await page.locator('.status-button').innerText();
const errorText = await page.locator('.error-banner').textContent().catch(() => null);
const landed = await page.locator(host).innerText().then((text) => text.split('lazy dog').length - 1);
await browser.close();

const pct = (values, p) => {
	const sorted = [...values].sort((a, b) => a - b);
	return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0);
};
const toPaint = data.keys.map((k) => k.toPaint);
const near = (t, events, before, after) => events.some((e) => t >= e.t - before && t <= e.end + after);
const busy = data.net.filter((n) => n.url.includes('?/save') || n.url.includes('__data.json'));
const slowKeys = data.keys.filter((k) => k.toPaint > 50);

const scriptTotals = {};
for (const f of data.frames) {
	for (const s of f.scripts) {
		const key = `${s.invoker} → ${s.source}`;
		scriptTotals[key] ??= { count: 0, total: 0, max: 0, layout: 0 };
		scriptTotals[key].count += 1;
		scriptTotals[key].total += s.duration;
		scriptTotals[key].layout += s.layout;
		scriptTotals[key].max = Math.max(scriptTotals[key].max, s.duration);
	}
}

const requests = Object.groupBy(data.net, (n) => n.url.replace(/\?x-sveltekit.*$/, '').replace(/^\/posts\/[^/?]+/, '/posts/:slug'));
const summary = {
	engine: engine.name(),
	editor,
	cpuRate,
	latencyMs,
	slug,
	keys: toPaint.length,
	sentencesLanded: landed,
	keyToPaintMs: { p50: pct(toPaint, 50), p90: pct(toPaint, 90), p99: pct(toPaint, 99), max: pct(toPaint, 100) },
	keysOver50ms: slowKeys.length,
	slowKeysNearSaveOrRefresh: slowKeys.filter((k) => near(k.t, busy, 50, 300)).length,
	requests: Object.fromEntries(
		Object.entries(requests).map(([url, list]) => [
			url,
			{
				count: list.length,
				maxMs: Math.round(Math.max(...list.map((n) => n.end - n.t))),
				maxConcurrent: Math.max(...list.map((n) => n.concurrent))
			}
		])
	),
	p90ByMinute: Object.values(Object.groupBy(data.keys, (k) => Math.floor((k.t - data.keys[0].t) / 60000))).map((bucket) =>
		pct(bucket.map((k) => k.toPaint), 90)
	),
	secondTab,
	memory: { before: memoryBefore, afterNav: memoryAfterNav },
	navFirst,
	stallMs,
	refreshAllBurst: Math.max(0, ...data.net.filter((n) => n.url.includes('__data.json')).map((n, i, list) => list.filter((m) => Math.abs(m.end - n.end) < 500).length)),
	slowKeyTimesS: slowKeys.map((k) => Math.round((k.t - data.keys[0].t) / 100) / 10),
	maxConcurrentFetches: Math.max(0, ...data.net.map((n) => n.concurrent)),
	longFrames: data.frames.length,
	longFrameMs: {
		total: Math.round(data.frames.reduce((s, f) => s + f.duration, 0)),
		max: Math.round(Math.max(0, ...data.frames.map((f) => f.duration)))
	},
	topScripts: Object.entries(scriptTotals)
		.sort((a, b) => b[1].total - a[1].total)
		.slice(0, 10),
	finalStatus: status,
	error: errorText
};
console.log(JSON.stringify(summary));
writeFileSync(`/tmp/cfcms-lag/raw-${engine.name()}-${editor}-${cpuRate}x-${latencyMs}ms-${slug}-${seconds}s${second ? '-2tab' : ''}${navFirst ? `-nav${navFirst}` : ''}${stallMs ? `-stall${stallMs}` : ''}.json`, JSON.stringify(data));
