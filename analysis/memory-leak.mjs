// Opens a post read-only and samples JS heap and script time, to catch an idle leak.
// Usage: node analysis/memory-leak.mjs <baseUrl> <slug> <seconds>
import { chromium } from '~/dev/blog/node_modules/playwright/index.mjs';

const [baseUrl, slug, secondsText] = process.argv.slice(2);
const seconds = Number(secondsText);
const sampleMs = 2_000;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
await context.addInitScript(() => localStorage.setItem('xccms:editor', 'aragonite'));
const page = await context.newPage();
page.on('console', (m) => m.type() === 'error' && console.log('console:', m.text().slice(0, 200)));
const cdp = await context.newCDPSession(page);
await cdp.send('Performance.enable');

await page.goto(`${baseUrl}/posts/${slug}`, { waitUntil: 'networkidle' });

const metric = (metrics, name) => metrics.find((m) => m.name === name)?.value ?? 0;
let lastScript = 0;
for (let t = 0; t <= seconds * 1000; t += sampleMs) {
	const { metrics } = await cdp.send('Performance.getMetrics');
	const script = metric(metrics, 'ScriptDuration') + metric(metrics, 'LayoutDuration') + metric(metrics, 'RecalcStyleDuration');
	console.log(
		`${(t / 1000).toFixed(0).padStart(3)}s heap ${(metric(metrics, 'JSHeapUsedSize') / 1e6).toFixed(1).padStart(8)} MB` +
			` nodes ${String(metric(metrics, 'Nodes')).padStart(8)} busy ${(((script - lastScript) * 1000) / sampleMs * 100).toFixed(0).padStart(4)}%`
	);
	lastScript = script;
	await page.waitForTimeout(sampleMs);
}
await browser.close();
