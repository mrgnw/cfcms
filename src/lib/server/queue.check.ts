// node --import ./scripts/check-hooks.ts src/lib/server/queue.check.ts
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'cms-queue-check-'));
mkdirSync(join(root, 'content/posts'), { recursive: true });
mkdirSync(join(root, 'src/posts'), { recursive: true });
execFileSync('git', ['init', '-q', '-b', 'main', root]);
writeFileSync(
	join(root, 'src/posts/live-post.svx'),
	'---\ntitle: Live Post\ndate: 2026-01-01\npublished: true\n---\n\nAlready on the site.\n'
);
writeFileSync(join(root, 'content/posts/reference-demo.llm.md'), '---\ntitle: Reference\ndate: 2026-01-01\n---\n\nDraft.\n');
process.env.BLOG_CONTENT_BASE_DIR = root;
process.env.BLOG_CMS_DB = join(root, 'cms.db');
process.chdir(root);

const { createPost } = await import('./content.ts');
const { getEditingOrder } = await import('./db.ts');
const queue = await import('./queue.ts');

try {
	const post = await createPost('title: A\ndate: 2026-01-01\ntags: []\npublish: false', '', 'mac');
	assert.equal(post.path, 'a.md');
	const draft = 'posts/reference-demo.llm.md';
	const queued = () => [...getEditingOrder().keys()];

	const aliases = ['./a.md', 'a/../a.md', 'posts/../a.md', 'posts\\..\\a.md', './posts/reference-demo.llm.md', 'posts/./reference-demo.llm.md', 'posts//reference-demo.llm.md'];
	for (const alias of aliases) {
		await assert.rejects(queue.queueAdd(alias), queue.QueueInputError, `queueAdd ${alias}`);
		assert.throws(() => queue.queueRemove(alias), queue.QueueInputError, `queueRemove ${alias}`);
		assert.throws(() => queue.queueReorder([alias]), queue.QueueInputError, `queueReorder ${alias}`);
		await assert.rejects(queue.trashPost(alias), queue.QueueInputError, `trashPost ${alias}`);
	}
	for (const escape of ['../a.md', '/a.md', 'a.txt', '', 'a'.repeat(queue.maxPostPathLength) + '.md']) {
		await assert.rejects(queue.queueAdd(escape), queue.QueueInputError, `queueAdd ${escape.slice(0, 20)}`);
	}
	assert.deepEqual(queued(), [], 'rejected paths leave no queue entry');

	await queue.queueAdd(draft);
	await queue.queueAdd('a.md');
	assert.deepEqual(queued(), [draft, 'a.md']);
	queue.queueReorder(['a.md', draft]);
	assert.deepEqual(queued(), ['a.md', draft]);
	await assert.rejects(queue.queueAdd('missing.md'), /Unknown post/);
	queue.queueRemove('a.md');
	assert.deepEqual(queued(), [draft]);
} finally {
	rmSync(root, { recursive: true, force: true });
}
