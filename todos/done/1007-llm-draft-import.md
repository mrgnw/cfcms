---
title: Import .llm.md drafts on route load, and bulk import from an admin page
branch: llm-draft-import
outcome: opening a standalone .llm.md imports it and lands on the post; /admin lists every draft by where its text goes (standalone, by-name, same-path) with per-draft and bulk import; collisions keep today's rule and a by-name draft can be imported as its own post, which detaches it
---

# Import .llm.md drafts on route load, and bulk import from an admin page

## Today (PR #30)

- A `.llm.md` with no post is imported on the next content scan, but only if the
  file appeared after the server's first scan. Older ones wait for the bulk
  button.
- The bulk button lives on the home panel ("Import N LLM drafts").
- An import creates `x.md` with an empty body written by `cms`; the draft's text
  is the `llm` version shown in the Reference pane.
- A `.llm.md` whose post already exists (same path with `.md`, or the one post
  whose slug matches; `llmOwner` in `src/lib/server/content.ts`) is ingested as
  a new `llm` version of that post on every scan.

## Wanted

1. **Import when a draft's route loads.** When a draft is opened and a
   corresponding `.llm.md` exists, import it asynchronously, without blocking
   the page, at least when the post has no `llm` version yet. Covers drafts that
   predate the server's first scan without needing the bulk button.
2. **Bulk import in a settings or admin page**, instead of (or as well as) the
   home panel button.
3. **Decide what importing a `.llm.md` does when a draft already exists.**
   Options to weigh:
   - attach it as a new `llm` version of the existing draft (what same-path
     files get today),
   - import it as a separate post at its own path,
   - show the collision in the admin page and let the writer choose.
   Consider drafts that already have an `llm` version, drafts the writer has
   edited, and slug matches across folders (`svelte-llm-rules.llm.md` vs
   `drafts/svelte llm rules.llm.md` used to overwrite each other).

## Constraints

- Idempotent: route loads, rescans, restarts and bulk runs never create
  duplicate posts or versions (`src/lib/llm-drafts.check.ts` covers today's
  rules; extend it).
- The human-written side stays the writer's: an import never fills the post body
  with LLM text.

## Decision

1. **Route load imports.** `/posts/<slug>` for a standalone `.llm.md` calls `importLlmDraft` and 303s to the post it
   created (`idea.llm.md` → `idea.md`, slug `idea`). The import is one file read and two store writes, so it runs in
   the load rather than in the background; the page the writer lands on is the imported post with the draft in its
   Reference pane. The "Start your version" button and the `fork` action are gone: a draft is never open as itself.
2. **Bulk import lives on `/admin`** (`AdminView.svelte`). The home panel keeps the count as a link there. The sidebar
   footer links to it.
3. **Collisions keep today's ownership rule**: same path, else the one post that shares the name, else standalone.
   What changes is that the by-name case is visible. `/admin` lists each draft under one of three headings
   (`classifyLlmDrafts` in `src/lib/llm-drafts.ts`): to import, feeding a post with a different path, attached to its
   own post. A by-name draft has "import as its own post", which creates the post at the draft's path; same path then
   wins and the draft stops feeding the other post. Its old `llm` version on that post stays until dismissed. Drafts
   the writer has edited are not special: an import never touches a body. A post that already has its own `.llm.md`
   never adopts a by-name draft (unchanged).

`importLlmDraft` is the one path for all three entry points, chained per target post, and idempotent: a second call
finds the post and adds no version. `src/lib/server/content.check.ts` covers that; `src/lib/llm-drafts.check.ts`
covers the classification and the by-name detach.

## log

- 2026-10-07 — implemented. Checked in a throwaway content root with three drafts: the route redirect, the three admin
  sections, and the sidebar after import.
