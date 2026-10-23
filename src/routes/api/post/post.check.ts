// node --import ./scripts/check-hooks.ts src/routes/api/post/post.check.ts
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'cms-api-post-check-'));
mkdirSync(join(root, 'content'));
mkdirSync(join(root, '.data'));
mkdirSync(join(root, 'src/posts'), { recursive: true });
execFileSync('git', ['init', '-q', '-b', 'main', root]);
// the startup import refuses a blog with no published posts
writeFileSync(
	join(root, 'src/posts/live-post.svx'),
	'---\ntitle: Live Post\ndate: 2026-01-01\npublished: true\n---\n\nAlready on the site.\n'
);
process.env.BLOG_CONTENT_BASE_DIR = root;
process.env.BLOG_CMS_DB = join(root, 'cms.db');
process.chdir(root);

const { listPosts } = await import('../../../lib/server/content.ts');
const { GET } = await import('./+server.ts');

type ApiPost = { id: string; url: string; title: string; body: string; versions: { writer: string; body: string }[] };
const get = (path: string) => GET({ url: new URL(`http://cms.test/api/post?path=${path}`) } as never);

try {
	// the first scan only records the auto-import baseline; a draft dropped after it is imported by the next scan
	await listPosts();
	writeFileSync(
		join(root, 'content/agent-draft.llm.md'),
		'---\ntitle: Agent Draft\ndate: 2026-10-22\ndraft: true\n---\n\nDrafted by an agent.\n'
	);
	await listPosts();

	const post = (await (await get('agent-draft.md')).json()) as ApiPost;
	assert.equal(post.title, 'Agent Draft');
	assert.equal(post.url, `http://cms.test/p/${post.id}`, 'url is the short link on the request origin');
	assert.equal(post.body, '', 'the human version stays empty');
	assert.deepEqual(
		post.versions.map((version) => [version.writer, version.body]),
		[['llm', 'Drafted by an agent.']],
		'the dropped draft is the llm version'
	);

	await assert.rejects(get('missing.md'), (caught: { status: number }) => caught.status === 404);
} finally {
	rmSync(root, { recursive: true, force: true });
}
