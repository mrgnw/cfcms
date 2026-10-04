---
title: Integrated diff view in the post editor
---

The reference pane shows versions (`live`, `llm`, `ext`, other writers) as segment cards: each card quotes the other text, a `replaces: …` line quotes mine, and offers take theirs / keep mine. That loses position — you cannot see where in the post a segment sits, what surrounds it, or how much of the document changed. A segment that "replaces: ### 2. Create `serve.json`" with a paragraph about `network_mode` is a heading-vs-paragraph misalignment the card view cannot show.

Plan and mock up a toggleable **integrated diff view** in `PostEditor`: the post body rendered once, with the other version's changes shown inline (added / removed / modified spans or blocks in place), and per-change accept/keep actions kept at the change. Toggle between the current card list and the inline view; the card list stays for small, isolated changes.

Deliverables:
- `mockups/diff-view-editor.html` — static mockup, light and dark, using the app tokens (see `src/lib/styles` or `src/app.css` and `mockups/sync-design.html` for the existing design language). Show: toggle, inline added/removed/modified, a heading-level change, a code block change, the per-change actions, and the "all resolved" state. Serve via dmox (`dmox url mockups/diff-view-editor.html`) and put the public URL in the todo log.
- A short plan appended to this file: data needed from `src/lib/segment-diff.ts` (does `Segment` carry enough position info? probably needs block index/offsets), what changes in `ReferencePane.svelte` vs `PostEditor.svelte`, how apply-segment stays identical, risks with the Milkdown editor surface.

Do not implement the component. Plan + mockup only. Follow the `design` and `design-data` skills.

## plan

Mockup: `mockups/diff-view-editor.html` (`#dark` / `#light` in the hash pins a theme).

**One paragraph of visual language, for the Publish view to converge on.** The body is rendered once, in the editor column, as block-shaped markdown text (heading, paragraph, fence). A changed block gets a 2.5px left rail and a faint tint in the kind colour already used by the cards: `--ok` added, `--accent` modified, `--danger` removed, `--warn` both changed. Inside a modified prose block, word-level `<ins>`/`<del>` marks; inside a fenced block, line-level `+`/`−` rows. Each change carries a small uppercase kind label and its two actions in a strip at its top right, same verbs as the cards. Unchanged blocks are plain. A compact index (dot + first words, one line per change) lists the changes and strikes them through as they are decided.

**What `Segment` must carry.** Nothing new for position. `applySegment` already finds a segment's place by content at apply time — `normalizeBlock(yours)` for modified/removed, `normalizeBlock(afterMain)` + 1 for added/conflict — and the inline renderer does the same lookup against the current `splitBlocks(bodyField)`. That keeps rendering and applying on one rule, and it stays correct while the user types between decisions, which a stored block index from load time would not. A segment whose anchor is no longer in the body (the user rewrote it, or Crepe normalised the markup) renders in an "unplaced" group at the bottom as a card; today that case is silently a no-op in `applySegment`, so the inline view makes it visible rather than worse.

**Change to `src/lib/segment-diff.ts`.** Add two small exports over the existing `lcsPairs`: `diffWords(yours, theirs)` tokenised on whitespace runs, and `diffLines(yours, theirs)` on `\n`, both returning `{ kind: 'same' | 'del' | 'add'; text: string }[]`, capped (2000 tokens / 400 lines → `null`, and the block falls back to whole-block del/ins). ~40 lines plus cases in `segment-diff.check.ts`. `Segment` and `diffSegments` are untouched, so the server, the store and the card view do not change.

**What moves between `ReferencePane.svelte` and `PostEditor.svelte`.**
- `PostEditor` owns `diffView: 'cards' | 'inline'` and the `resolved` / `fieldResolved` sets (lifted out of `ReferencePane`, reset through the existing `{#key sourceKey(activeSource)}`), so toggling views keeps decisions.
- `ReferencePane` gains the Cards / Inline segment in `.reference-head` (shown only when `segments != null`; Insert / Copy hides then, it only applies to the plain block list). In inline mode it renders the change index instead of the `.segment` list. Props in: `diffView`, `resolved`, `onDiffView`, `onResolve`.
- New `InlineDiff.svelte` (~220 lines with CSS): props `body`, `segments`, `resolved`, `onApplySegment`, `onResolve`. Builds the interleaved block list, renders rails, marks and action strips, exposes ids the index scrolls to.
- `PostEditor` renders `InlineDiff` inside `.editor-body` and wraps `MilkdownEditor` in a `hidden` container while inline is on. Crepe stays mounted; destroying it loses undo history and costs a full re-create on every toggle.

**How `onApplySegment` stays identical.** `InlineDiff` calls the same `onApplySegment(segment)` prop that the cards call, and `PostEditor` passes the existing `applySegment` unchanged. `applySegment` → `replaceBody` → `milkdown.setContent` → `onChange` → `bodyField`; the inline body is derived from `bodyField`, so it re-renders with the remaining segments re-placed. No new apply path, no second body state.

**Risks with the Milkdown surface (`MilkdownEditor.svelte`).**
- `replaceAll` while the host is `hidden`: ProseMirror applies the transaction without layout, so it should work, but verify once; `insertMarkdown` focuses the view and is not used from inline mode.
- Crepe rewrites markdown on `markdownUpdated` (list markers, fence style, escapes). After an apply, `bodyField` is Crepe's text, not `blocks.join('\n\n')`; `normalizeBlock` only folds whitespace, so a markup rewrite can orphan a later segment. The cards have this today; inline surfaces it as "unplaced". If it bites, normalise through Crepe once at diff time rather than loosening `normalizeBlock`.
- Two identical blocks in the body: `indexOf` places the first, same as `applySegment`. Accept.
- The body is read-only in inline mode; drag-and-drop from the pane is off. Mobile keeps the pane static above the body (existing `≤960px` rule), the index wraps into chips, actions go full width under the label.

**Size.** `segment-diff.ts` +40 and check cases; `InlineDiff.svelte` ~220; `ReferencePane.svelte` −40/+50; `PostEditor.svelte` +40. No new dependency. About one day including the Crepe-hidden check.

## log

- 2026-10-04 — mockup and plan. Mockup served by dmox from the main checkout once merged: https://mox.xcc.es/blog-cms/diff-view-editor.html (dark: append `#dark`). dmox serves `**/mockups/` under `~/dev` only, so the worktree copy has no URL before merge; reviewed via a temporary local server at 1200px and 390px, light and dark.
