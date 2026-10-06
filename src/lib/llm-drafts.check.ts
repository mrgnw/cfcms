import assert from 'node:assert/strict';
import { llmImportPlan, llmOwnerPath, llmUserPath, standaloneLlmFiles, type LlmFile } from './llm-drafts.ts';

const file = (path: string, mtimeMs = 100): LlmFile => ({ path, mtimeMs });

assert.equal(llmOwnerPath('a.llm.md', ['a.md', 'blog/a.md'], new Set()), 'a.md', 'same path wins');
assert.equal(llmOwnerPath('drafts/b.llm.md', ['blog/b.md'], new Set()), 'blog/b.md', 'one name match elsewhere owns it');
assert.equal(llmOwnerPath('c.llm.md', ['x/c.md', 'y/c.md'], new Set()), null, 'two name matches: ambiguous, no owner');
assert.equal(
	llmOwnerPath('drafts/svelte llm rules.llm.md', ['svelte-llm-rules.md'], new Set(['svelte-llm-rules.llm.md'])),
	null,
	'a post fed by its own draft never adopts a second same-named draft'
);

const importAll = (llmFiles: LlmFile[], postPaths: string[]) => {
	const plan = standaloneLlmFiles(llmFiles, postPaths);
	return { imported: plan.length, postPaths: [...postPaths, ...plan.map((item) => llmUserPath(item.path))] };
};

const drafts = [file('svelte-llm-rules.llm.md'), file('drafts/svelte llm rules.llm.md'), file('drafts/c.llm.md'), file('d.llm.md')];
const first = importAll(drafts, ['x/c.md', 'y/c.md', 'd.md']);
assert.equal(first.imported, 3, 'collisions import at their own path; owned drafts are skipped');
assert.deepEqual(
	first.postPaths.slice(3).sort(),
	['drafts/c.md', 'drafts/svelte llm rules.md', 'svelte-llm-rules.md'],
	'each draft becomes the post next to it'
);
assert.equal(new Set(first.postPaths).size, first.postPaths.length, 'no duplicate posts');
const second = importAll(drafts, first.postPaths);
assert.equal(second.imported, 0, 'second bulk run imports nothing');
for (const draft of drafts) {
	const owner = llmOwnerPath(draft.path, second.postPaths, new Set(drafts.map((item) => item.path)));
	assert.equal(owner, llmUserPath(draft.path), 'rewrites land on the imported post');
}

const standalone = [file('old.llm.md', 50), file('new.llm.md', 150), file('purged.llm.md', 150)];
assert.deepEqual(
	llmImportPlan(standalone, new Set(['purged.llm.md']), 100).map((item) => item.path),
	['new.llm.md'],
	'auto-import takes only drafts written since the baseline and never re-imports a recorded one'
);

console.log('llm-drafts.check: ok');
