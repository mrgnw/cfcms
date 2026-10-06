---
title: Import .llm.md drafts on route load, and bulk import from an admin page
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
