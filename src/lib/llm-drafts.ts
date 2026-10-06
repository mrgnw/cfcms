import { slugKey } from './svx.ts';

export type LlmFile = { path: string; mtimeMs: number };

const baseName = (postPath: string) => postPath.replace(/\.md$/, '').split('/').at(-1) ?? '';

export const llmUserPath = (llmPath: string) => llmPath.replace(/\.llm\.md$/, '.md');

const ownLlmPath = (postPath: string) => postPath.replace(/\.md$/, '.llm.md');

// An llm draft belongs to the post at the same path, else to the one post anywhere whose name matches it.
// A post fed by its own .llm.md never adopts a second draft by name: two drafts would overwrite one llm version.
export const llmOwnerPath = (llmPath: string, postPaths: string[], llmPaths: Set<string>): string | null => {
	const samePath = llmUserPath(llmPath);
	if (postPaths.includes(samePath)) return samePath;
	const key = slugKey(baseName(samePath));
	const byName = postPaths.filter(
		(postPath) => slugKey(baseName(postPath)) === key && !llmPaths.has(ownLlmPath(postPath))
	);
	return byName.length === 1 ? byName[0] : null;
};

export const standaloneLlmFiles = (llmFiles: LlmFile[], postPaths: string[]) => {
	const llmPaths = new Set(llmFiles.map((file) => file.path));
	return llmFiles.filter((file) => !llmOwnerPath(file.path, postPaths, llmPaths));
};

// Auto-import takes drafts written since the baseline and never re-imports one it already imported (a purged
// post stays purged). The bulk action skips this filter and imports every standalone draft.
export const llmImportPlan = (standalone: LlmFile[], imported: Set<string>, sinceMs: number) =>
	standalone.filter((file) => file.mtimeMs >= sinceMs && !imported.has(file.path));
