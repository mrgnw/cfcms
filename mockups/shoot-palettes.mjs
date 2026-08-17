const playwrightEntry = '~/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
const { chromium } = await import(playwrightEntry);

const file = 'file://~/dev/blog-cms/mockups/theme-palettes.html';
const outDir = '/tmp/palette-shots';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, deviceScaleFactor: 2 });
await page.goto(file);

const lights = await page.$$eval('#lights .pal-btn', (els) => els.map((el) => el.dataset.id));
const darks = await page.$$eval('#darks .pal-btn', (els) => els.map((el) => el.dataset.id));
console.log(`${lights.length} lights, ${darks.length} darks`);

// dark stays on Slate — the light is what needs comparing
for (const id of lights) {
	await page.click(`#lights .pal-btn[data-id="${id}"]`);
	await page.waitForTimeout(120);
	const frames = await page.$$('.frame');
	if (frames.length !== 2) throw new Error(`${id}: expected 2 frames, got ${frames.length}`);
	const label = await frames[0].$eval('.frame-label', (el) => el.textContent.trim());
	if (!label.toLowerCase().includes('light')) throw new Error(`first frame is not the light one: ${label}`);
	await frames[0].screenshot({ path: `${outDir}/light-${id}.png` });
	console.log('shot', label);
}

for (const id of darks) {
	await page.click(`#darks .pal-btn[data-id="${id}"]`);
	await page.waitForTimeout(120);
	const frame = (await page.$$('.frame'))[1];
	await frame.screenshot({ path: `${outDir}/dark-${id}.png` });
	console.log('shot', await frame.$eval('.frame-label', (el) => el.textContent.trim()));
}
await page.click('#darks .pal-btn[data-id="slate"]');
await page.locator('.controls').screenshot({ path: `${outDir}/controls.png` });

const paperBg = await page.$eval('.shell[data-mode="dark"]', (el) => getComputedStyle(el).getPropertyValue('--paper').trim());
if (!paperBg) throw new Error('dark tokens not applied');
console.log('dark --paper:', paperBg);

// escape sequences in the markup template literal turn into real line breaks inside <pre>
const codeLines = await page.$eval('.shell .fence pre', (el) => el.textContent.trim().split('\n').length);
if (codeLines !== 9) throw new Error(`code fence has ${codeLines} lines, expected 9 — check backslash escaping`);
console.log('code fence lines:', codeLines);

const fenceBg = await page.$eval('.shell[data-mode="dark"] .fence', (el) => getComputedStyle(el).backgroundColor);
const pageBg = await page.$eval('.shell[data-mode="dark"] .workbench', (el) => getComputedStyle(el).backgroundColor);
if (fenceBg === pageBg) throw new Error('fence does not separate from the page');
console.log('fence', fenceBg, '!= workbench', pageBg);

await browser.close();
console.log('shoot-palettes: ok ->', outDir);
