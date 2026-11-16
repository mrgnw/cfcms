import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

const root = mkdtempSync(join(tmpdir(), 'cms-assistant-race-check-'));
process.env.BLOG_CMS_DB = join(root, 'cms.db');
process.env.BLOG_CONTENT_BASE_DIR = root;
const { appendRevision, changeAssistantDraft, getAssistantDraft } = await import('./db.ts');
const path = 'race.md';
const text = { baseHash: 'human-hash', frontmatter: 'title: Human', body: 'Initial suggestion' };
appendRevision(path, text.frontmatter, 'Human body', text.baseHash, 'mac');
changeAssistantDraft(path, null, () => text);
const revision = getAssistantDraft(path)!.revision;

const source = `
	import { parentPort, workerData } from 'node:worker_threads';
	await import(workerData.hooks);
	const { changeAssistantDraft, getAssistantDraft } = await import(workerData.database);
	getAssistantDraft(workerData.path);
	parentPort.once('message', () => {
		try {
			const result = changeAssistantDraft(workerData.path, workerData.revision, () => {
				if (workerData.hold) {
					parentPort.postMessage('locked');
					Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
				}
				return { ...workerData.text, body: 'Winning suggestion' };
			});
			parentPort.postMessage(result.outcome);
		} catch (caught) {
			parentPort.postMessage({ error: caught.message });
		}
	});
	parentPort.postMessage('ready');
`;
const createWorker = (hold: boolean) => new Worker(new URL(`data:text/javascript,${encodeURIComponent(source)}`), {
	workerData: {
		path, text, revision, hold,
		hooks: new URL('../../../scripts/check-hooks.ts', import.meta.url).href,
		database: new URL('./db.ts', import.meta.url).href
	}
});
const first = createWorker(true);
const second = createWorker(false);
try {
	assert.deepEqual(await Promise.all([once(first, 'message'), once(second, 'message')]), [['ready'], ['ready']]);
	const locked = once(first, 'message');
	first.postMessage('write');
	assert.deepEqual(await locked, ['locked']);
	const finished = Promise.all([once(first, 'message'), once(second, 'message')]);
	second.postMessage('write');
	assert.deepEqual(await finished, [['write'], ['conflict']], 'separate connections serialize before checking the token');
	assert.equal(getAssistantDraft(path)!.body, 'Winning suggestion');
} finally {
	await Promise.all([first.terminate(), second.terminate()]);
	rmSync(root, { recursive: true, force: true });
}
