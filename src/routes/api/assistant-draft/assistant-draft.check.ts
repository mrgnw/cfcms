import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'cms-assistant-api-check-'));
process.env.BLOG_CMS_DB = join(root, 'cms.db');
process.env.BLOG_CONTENT_BASE_DIR = root;

const { GET, PUT, PATCH } = await import('./+server.ts');
const { GET: getPost } = await import('../post/+server.ts');
const {
	appendRevision, deleteVersion, getAssistantDraft, getStoredPost, getPublishedPosts, getStagedPaths,
	listRevisions, recordPublished, setStaged, upsertVersion
} = await import('../../../lib/server/db.ts');
const { hashPostContent } = await import('../../../lib/post-text.ts');
const { diffSegments } = await import('../../../lib/segment-diff.ts');
const { assistantRequestMaxBytes, assistantDraftMaxBytes } = await import('../../../lib/server/assistant-draft.ts');

const path = 'human.md';
const frontmatter = 'title: Human\npublish: true';
const humanBody = 'Original human paragraph.';
const baseHash = hashPostContent(frontmatter, humanBody);
const url = new URL('http://cms.test/api/assistant-draft?path=human.md');
const event = (request: Request, target = url) => ({ request, url: target }) as never;
const read = (target = url) => GET(event(new Request(target), target));
const write = (method: 'PUT' | 'PATCH', body: unknown, target = url, headers: Record<string, string> = {}) => {
	const request = new Request(target, {
		method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body)
	});
	return (method === 'PUT' ? PUT : PATCH)(event(request, target));
};
const expectStatus = async (work: () => unknown, status: number) =>
	assert.rejects(async () => work(), (caught: { status: number }) => caught.status === status);

try {
	appendRevision(path, frontmatter, humanBody, baseHash, 'mac');
	recordPublished([{ path, title: 'Human', slug: 'human', contentHash: baseHash }], 'published-commit');
	setStaged(path, true);
	const human = getStoredPost(path);
	const published = getPublishedPosts();
	const history = listRevisions(path);
	const replacement = { revision: null, baseHash, frontmatter: 'title: Assistant\r\npublish: false', body: 'Suggested paragraph.\n' };
	assert.deepEqual(await (await read()).json(), { path, humanContentHash: baseHash, draft: null });
	const createdResponse = await write('PUT', replacement);
	assert.equal(createdResponse.status, 201);
	const created = (await createdResponse.json()).draft;
	assert.equal(created.body, 'Suggested paragraph.');
	assert.equal(created.frontmatter, 'title: Assistant\npublish: false');
	assert.equal(created.baseHash, baseHash);
	assert.ok(created.revision);
	assert.equal((await (await read()).json()).draft.revision, created.revision);
	await expectStatus(() => write('PUT', replacement), 409);
	await expectStatus(() => write('PUT', { ...replacement, revision: created.revision, baseHash: '0'.repeat(64) }), 409);
	assert.equal(getAssistantDraft(path)!.revision, created.revision);

	const patch = { revision: created.revision, edits: [
		{ field: 'body', find: 'Suggested', replace: 'Revised' },
		{ field: 'frontmatter', find: 'Assistant', replace: 'Reviewer' },
		{ field: 'body', find: 'Revised paragraph.', replace: 'Revised paragraph.\n\nA second paragraph.' }
	] };
	const patched = (await (await write('PATCH', patch)).json()).draft;
	assert.equal(patched.body, 'Revised paragraph.\n\nA second paragraph.');
	assert.equal(patched.frontmatter, 'title: Reviewer\npublish: false');
	assert.notEqual(patched.revision, created.revision);
	assert.equal(patched.baseHash, baseHash);
	await expectStatus(() => write('PATCH', patch), 409);

	const edit = (find: string, replace = '') => ({ field: 'body', find, replace });
	await expectStatus(() => write('PATCH', { revision: patched.revision, edits: [edit('Revised', 'First'), edit('absent')] }), 409);
	await expectStatus(() => write('PATCH', { revision: patched.revision, edits: [edit('paragraph.')] }), 409);
	assert.deepEqual(getAssistantDraft(path)!.body, patched.body, 'a failed edit batch is atomic');
	assert.equal(getAssistantDraft(path)!.revision, patched.revision);

	const fromPost = await (await getPost({ url } as never)).json();
	assert.equal(fromPost.body, humanBody);
	assert.deepEqual(fromPost.versions.map((version: { writer: string; body: string }) => [version.writer, version.body]), [
		['llm', patched.body]
	]);
	const segments = diffSegments(humanBody, humanBody, patched.body);
	assert.ok(segments);
	assert.ok(segments.length > 0, 'assistant text has a base for reference review');
	assert.deepEqual(getStoredPost(path), human);
	assert.deepEqual(listRevisions(path), history);
	assert.deepEqual(getPublishedPosts(), published);
	assert.deepEqual([...getStagedPaths()], [path]);

	const concurrent = await Promise.allSettled([
		write('PATCH', { revision: patched.revision, edits: [edit('Revised', 'Agent one')] }),
		write('PATCH', { revision: patched.revision, edits: [edit('Revised', 'Agent two')] })
	]);
	assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
	const rejected = concurrent.find((result) => result.status === 'rejected');
	assert.equal(rejected?.reason.status, 409);
	const current = getAssistantDraft(path)!;
	const fullReplacement = await write('PUT', { ...replacement, revision: current.revision, body: 'Full replacement.' });
	assert.equal(fullReplacement.status, 200);
	assert.equal(getAssistantDraft(path)!.body, 'Full replacement.');

	const beforeBadRequests = getAssistantDraft(path)!;
	for (const invalid of [null, [], {}, { ...replacement, revision: undefined }, { ...replacement, body: 4 },
		{ ...replacement, revision: '' }, { ...replacement, baseHash: 'bad' }, { ...replacement, writer: 'mac' }]) {
		await expectStatus(() => write('PUT', invalid), 400);
	}
	for (const edits of [[], Array.from({ length: 33 }, () => edit('x')), [edit('')],
		[{ field: 'path', find: 'x', replace: 'y' }], [{ field: 'body', find: 'x', replace: 3 }]]) {
		await expectStatus(() => write('PATCH', { revision: beforeBadRequests.revision, edits }), 400);
	}
	await expectStatus(() => write('PATCH', { revision: null, edits: [edit('x')] }), 400);
	await expectStatus(() => write('PUT', replacement, url, { 'content-type': 'text/plain' }), 415);
	await expectStatus(() => write('PUT', replacement, url, { origin: 'https://untrusted.test' }), 403);
	await expectStatus(() => write('PUT', replacement, url, { 'sec-fetch-site': 'cross-site' }), 403);
	await expectStatus(() => write('PUT', replacement, url, { 'content-length': String(assistantRequestMaxBytes + 1) }), 413);
	await expectStatus(() => write('PUT', { ...replacement, body: 'x'.repeat(assistantRequestMaxBytes) }), 413);
	let cancelled = false;
	const oversizedStream = new ReadableStream<Uint8Array>({
		start(controller) { controller.enqueue(new Uint8Array(assistantRequestMaxBytes + 1)); },
		cancel() { cancelled = true; }
	});
	await expectStatus(() => PUT(event(new Request(url, {
		method: 'PUT', headers: { 'content-type': 'application/json' }, body: oversizedStream, duplex: 'half'
	} as RequestInit))), 413);
	assert.equal(cancelled, false, 'leave the transport open so the adapter can send the 413 response');
	await expectStatus(() => write('PUT', { ...replacement, body: 'é'.repeat(assistantDraftMaxBytes) }), 413);
	await expectStatus(() => write('PATCH', { revision: beforeBadRequests.revision,
		edits: [edit('Full', 'x'.repeat(assistantDraftMaxBytes))] }), 413);
	await expectStatus(() => PUT(event(new Request(url, {
		method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{'
	}))), 400);
	const invalidUtf8 = new Uint8Array([0x22, 0xc3, 0x28, 0x22]);
	await expectStatus(() => PUT(event(new Request(url, {
		method: 'PUT', headers: { 'content-type': 'application/json' }, body: invalidUtf8
	}))), 400);
	assert.deepEqual(getAssistantDraft(path), beforeBadRequests);

	for (const invalidPath of ['', '../human.md', '/human.md', 'human.llm.md', 'human.svx', 'a//human.md', 'a\\human.md']) {
		const invalidUrl = new URL(url);
		invalidUrl.searchParams.set('path', invalidPath);
		await expectStatus(() => read(invalidUrl), 400);
		await expectStatus(() => write('PUT', replacement, invalidUrl), 400);
	}
	const missingUrl = new URL('http://cms.test/api/assistant-draft?path=missing.md');
	await expectStatus(() => read(missingUrl), 404);
	await expectStatus(() => write('PUT', replacement, missingUrl), 404);
	await expectStatus(() => write('PATCH', patch, missingUrl), 404);

	upsertVersion({ path, writer: 'llm', sessionId: 'file', baseHash, frontmatter, body: 'Imported file.' });
	await expectStatus(() => write('PUT', { ...replacement, revision: beforeBadRequests.revision }), 409);
	const beforeDismiss = getAssistantDraft(path)!;
	deleteVersion(path, 'llm');
	await expectStatus(() => write('PATCH', { revision: beforeDismiss.revision, edits: [edit('Imported')] }), 409);
	assert.equal((await (await read()).json()).draft, null);
	assert.equal((await write('PUT', replacement, url, { origin: url.origin })).status, 201);
	assert.notEqual(getAssistantDraft(path)!.revision, beforeDismiss.revision);

	const oldDraft = getAssistantDraft(path)!;
	const nextHumanBody = 'Human changed independently.';
	const nextHumanHash = hashPostContent(frontmatter, nextHumanBody);
	appendRevision(path, frontmatter, nextHumanBody, nextHumanHash, 'mac');
	await expectStatus(() => write('PUT', { ...replacement, revision: oldDraft.revision }), 409);
	await write('PATCH', { revision: oldDraft.revision, edits: [edit('Suggested', 'Edited')] });
	assert.equal(getAssistantDraft(path)!.baseHash, baseHash, 'patch preserves the original human comparison base');
	assert.equal(getStoredPost(path)!.body, nextHumanBody);
	await write('PUT', { ...replacement, revision: getAssistantDraft(path)!.revision, baseHash: nextHumanHash });
	assert.equal(getAssistantDraft(path)!.baseHash, nextHumanHash, 'full replacement may use the latest human base');

	const legacyBody = `REMOVE-ONE\n\nREMOVE-TWO\n\n${'x'.repeat(assistantDraftMaxBytes + 64)}`;
	upsertVersion({ path, writer: 'llm', sessionId: 'file', baseHash: nextHumanHash, frontmatter, body: legacyBody });
	const legacy = getAssistantDraft(path)!;
	const smallerResponse = await write('PATCH', { revision: legacy.revision, edits: [edit('REMOVE-ONE\n\n')] });
	assert.equal(smallerResponse.status, 200, 'an oversized imported draft can shrink incrementally');
	const smaller = getAssistantDraft(path)!;
	assert.ok(smaller.body.length < legacyBody.length);
	assert.ok(Buffer.byteLength(smaller.body) > assistantDraftMaxBytes);
	await expectStatus(() => write('PATCH', { revision: smaller.revision, edits: [edit('REMOVE-TWO', 'y'.repeat(100))] }), 413);
	await expectStatus(() => write('PATCH', { revision: smaller.revision,
		edits: [{ field: 'frontmatter', find: 'Human', replace: 'Other' }] }), 413);
	assert.equal(getAssistantDraft(path)!.revision, smaller.revision);
	await write('PATCH', { revision: smaller.revision, edits: [edit('REMOVE-TWO\n\n')] });
	assert.ok(getAssistantDraft(path)!.body.length < smaller.body.length);

	const customFrontmatter = 'title: Valid\ncustom:\n  nested: true\nsummary: |\n  Multiple lines\n  stay intact.';
	await write('PUT', { revision: getAssistantDraft(path)!.revision, baseHash: nextHumanHash,
		frontmatter: customFrontmatter, body: 'Valid body.' });
	const valid = getAssistantDraft(path)!;
	assert.equal(valid.frontmatter, customFrontmatter);
	for (const invalidFrontmatter of ['title: [', "title: 'unterminated", '- item', 'not a mapping',
		'---\ntitle: X\n---', 'title: X\n...', 'title: X\ntitle: Y', 'custom: *unknown', 'title: X\u0000']) {
		await expectStatus(() => write('PUT', { revision: valid.revision, baseHash: nextHumanHash,
			frontmatter: invalidFrontmatter, body: 'Valid body.' }), 400);
	}
	await expectStatus(() => write('PATCH', { revision: valid.revision, edits: [
		edit('Valid body.', 'This must roll back.'),
		{ field: 'frontmatter', find: 'title: Valid', replace: 'title: [' }
	] }), 400);
	assert.deepEqual(getAssistantDraft(path), valid, 'invalid frontmatter cannot change text or its token');

	upsertVersion({ path, writer: 'llm', sessionId: 'file', baseHash: nextHumanHash,
		frontmatter: 'title: [\ncustom: Kept', body: 'Imported body.' });
	const invalidImport = getAssistantDraft(path)!;
	await expectStatus(() => write('PATCH', { revision: invalidImport.revision,
		edits: [edit('Imported body.', 'Edited body.')] }), 400);
	assert.deepEqual(getAssistantDraft(path), invalidImport, 'body-only edits preserve an invalid imported draft on rejection');
	const repairedResponse = await write('PATCH', { revision: invalidImport.revision, edits: [
		edit('Imported body.', 'Edited body.'),
		{ field: 'frontmatter', find: 'title: [', replace: 'title: Repaired' }
	] });
	assert.equal(repairedResponse.status, 200, 'PATCH can repair imported frontmatter and edit the body atomically');
	assert.equal(getAssistantDraft(path)!.frontmatter, 'title: Repaired\ncustom: Kept');
	assert.equal(getAssistantDraft(path)!.body, 'Edited body.');
} finally {
	rmSync(root, { recursive: true, force: true });
}
