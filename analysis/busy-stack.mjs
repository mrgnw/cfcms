// Opens a post, waits, then pauses the debugger to print what the main thread is running.
// Usage: node analysis/busy-stack.mjs <baseUrl> <slug> <waitMs>
import { chromium } from '~/dev/blog/node_modules/playwright/index.mjs';

const [baseUrl, slug, waitText] = process.argv.slice(2);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
await context.addInitScript(() => localStorage.setItem('xccms:editor', 'aragonite'));
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('Debugger.enable');

page.goto(`${baseUrl}/posts/${slug}`).catch(() => {});
await new Promise((r) => setTimeout(r, Number(waitText)));

for (let i = 0; i < 3; i++) {
	const paused = new Promise((r) => cdp.once('Debugger.paused', r));
	await cdp.send('Debugger.pause');
	const { callFrames } = await paused;
	console.log(`--- sample ${i}`);
	for (const f of callFrames.slice(0, 25)) {
		console.log(`${f.functionName || "(anon)"}  ${f.url.split("/").at(-1)}:${f.location.lineNumber + 1}:${f.location.columnNumber + 1}`);
		if (i === 0 && !f.url) { const { scriptSource } = await cdp.send("Debugger.getScriptSource", { scriptId: f.location.scriptId }); const line = scriptSource.split("\n")[f.location.lineNumber]; console.log("   >>", line.slice(Math.max(0, f.location.columnNumber - 400), f.location.columnNumber + 400)); }
	}
	await cdp.send('Debugger.resume');
	await new Promise((r) => setTimeout(r, 300));
}
await browser.close();
process.exit(0);
