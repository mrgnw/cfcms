import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'cms-assistant-check-'));
process.env.BLOG_CMS_DB = join(root, 'cms.db');
process.env.BLOG_CONTENT_BASE_DIR = root;

const {
	appendRevision, changeAssistantDraft, deleteVersion, getAssistantDraft, getPublishedPosts,
	getStoredPost, getStagedPaths, listRevisions, listVersions, recordPublished, setStaged, upsertVersion
} = await import('./db.ts');

try {
	const path = 'human.md';
	const text = { frontmatter: 'title: Suggestion', body: 'Assistant body', baseHash: 'human-hash' };
	assert.deepEqual(changeAssistantDraft(path, null, () => text), { outcome: 'missing' });
	appendRevision(path, 'title: Human', 'Human body', 'human-hash', 'mac');
	recordPublished([{ path, title: 'Human', slug: 'human', contentHash: 'human-hash' }], 'published-commit');
	setStaged(path, true);
	const human = getStoredPost(path);
	const published = getPublishedPosts();
	const history = listRevisions(path);
	upsertVersion({ path, writer: 'ph', sessionId: 'phone1', ...text, body: 'Phone body' });
	const other = listVersions(path).find((version) => version.writer === 'ph');

	assert.equal(getAssistantDraft(path), null);
	const created = changeAssistantDraft(path, null, () => text);
	assert.equal(created.outcome, 'write');
	const first = getAssistantDraft(path)!;
	assert.ok(first.revision);
	let called = false;
	assert.deepEqual(changeAssistantDraft(path, null, () => { called = true; return text; }), { outcome: 'conflict' });
	assert.equal(called, false);
	assert.deepEqual(getAssistantDraft(path), first);

	assert.throws(() => changeAssistantDraft(path, first.revision, () => { throw new Error('invalid edit'); }), /invalid edit/);
	assert.deepEqual(getAssistantDraft(path), first, 'failed edits roll back');
	assert.equal(changeAssistantDraft(path, first.revision, () => ({ ...text, body: 'Updated' })).outcome, 'write');
	const updated = getAssistantDraft(path)!;
	assert.notEqual(updated.revision, first.revision);
	assert.deepEqual(changeAssistantDraft(path, first.revision, () => text), { outcome: 'conflict' });

	upsertVersion({ path, writer: 'llm', sessionId: 'file', ...text });
	const imported = getAssistantDraft(path)!;
	assert.notEqual(imported.revision, updated.revision, 'file imports also invalidate tokens');
	assert.deepEqual(changeAssistantDraft(path, updated.revision, () => text), { outcome: 'conflict' });
	deleteVersion(path, 'llm');
	assert.deepEqual(changeAssistantDraft(path, imported.revision, () => text), { outcome: 'conflict' });
	assert.equal(changeAssistantDraft(path, null, () => text).outcome, 'write');
	assert.notEqual(getAssistantDraft(path)!.revision, imported.revision, 'recreating identical text invalidates old tokens');

	assert.deepEqual(getStoredPost(path), human);
	assert.deepEqual(listRevisions(path), history);
	assert.deepEqual(getPublishedPosts(), published);
	assert.deepEqual([...getStagedPaths()], [path]);
	assert.deepEqual(listVersions(path).find((version) => version.writer === 'ph'), other);
	assert.deepEqual(listVersions(path).map((version) => version.writer), ['llm', 'ph']);
} finally {
	rmSync(root, { recursive: true, force: true });
}
