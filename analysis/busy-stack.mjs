// Opens a post, waits, then pauses the debugger to print what the main thread is running.
// Use when a page pins a CPU: CDP calls that wait on the main thread hang, Debugger.pause does not.
// Usage: node analysis/busy-stack.mjs <baseUrl> <slug> <waitMs>
import { chromium } from '~/dev/blog/node_modules/playwright/index.mjs';

const [baseUrl, slug, waitText] = process.argv.slice(2);
const samples = 3;
const snippetChars = 400;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('Debugger.enable');

page.goto(`${baseUrl}/posts/${slug}`).catch(() => {});
await new Promise((r) => setTimeout(r, Number(waitText)));

const snippet = async ({ scriptId, lineNumber, columnNumber }) => {
	const { scriptSource } = await cdp.send('Debugger.getScriptSource', { scriptId });
	const line = scriptSource.split('\n')[lineNumber];
	return line.slice(Math.max(0, columnNumber - snippetChars), columnNumber + snippetChars);
};

for (let i = 0; i < samples; i++) {
	const paused = new Promise((r) => cdp.once('Debugger.paused', r));
	await cdp.send('Debugger.pause');
	const { callFrames } = await paused;
	console.log(`--- sample ${i}`);
	for (const f of callFrames.slice(0, 25)) {
		const at = `${f.url.split('/').at(-1)}:${f.location.lineNumber + 1}:${f.location.columnNumber + 1}`;
		console.log(`${f.functionName || '(anon)'}  ${at}`);
		if (i === 0) console.log(`   >> ${await snippet(f.location)}`);
	}
	await cdp.send('Debugger.resume');
	await new Promise((r) => setTimeout(r, 300));
}
await browser.close();
process.exit(0);
