---
title: Integrated diff view in the post editor
---

The reference pane shows versions (`site`, `llm`, `ext`, other writers) as segment cards: each card quotes the other text, a `replaces: …` line quotes mine, and offers take theirs / keep mine. That loses position — you cannot see where in the post a segment sits, what surrounds it, or how much of the document changed. A segment that "replaces: ### 2. Create `serve.json`" with a paragraph about `network_mode` is a heading-vs-paragraph misalignment the card view cannot show.

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

## margin variant

Mockup: `mockups/diff-view-editor-margin.html` (`#dark` / `#light` pins a theme). Preview while this branch is unmerged: https://mox.xcc.es/_preview/blog-cms/diff-view-editor-margin.html

**What stays the same as the first plan.** The body is the current `bodyField`, rendered once as block-shaped markdown text. Segments are placed by content at render time with the same lookup `applySegment` uses (`normalizeBlock(yours)` for modified/removed, `normalizeBlock(afterMain)` + 1 for added/conflict), so a segment the body no longer contains renders as an unplaced card at the end of the margin. `diffWords` / `diffLines` are still needed, but only to decide *which tokens of mine* get the underline and to render the ins/del view inside the card. `Segment`, `diffSegments`, the store, the server and `applySegment` do not change. The Cards / Inline segment, the lifted `resolved` set and the hidden-but-mounted Crepe are as in the first plan.

**Marks.** One system: my text, underlined in the kind colour (`--accent` modified, `--danger` removed, `--warn` conflict), with the underline on the differing tokens only and the whole range (first to last differing token) wrapped in one `<button class="mark">`. `added` has no text of mine, so its mark is a caret `‸` in `--ok` on its own row at the insertion point (the task brief says "removed range has nothing to show"; in `Segment` terms the empty one is `added`, `removed` still has `yours` in the body). A fence change wraps the changed lines in the same button. A decided segment drops the underline and keeps a faint `✓`. Nothing of theirs is rendered in the body.

**Margin alignment.** Each mark gets `anchor-name: --m{i}`, each card `position-anchor: --m{i}; top: calc(anchor(top) + var(--push))`. Two things the mockup had to get right: the anchor must precede the positioned card in DOM order and the card's containing block must contain the anchor, so the DOM is body then margin, the grid (`position: relative`) is the containing block, and `grid-column` puts the margin on the left where `ReferencePane` sits. Anchor positioning does not resolve collisions between sibling cards, so a measured pass sets `--push` per card (one `getBoundingClientRect` loop top to bottom, pushing each card below the previous one's bottom + 8px, then sets the margin's `min-height`) and reruns on resize and after a decision. The `anchor()` top keeps cards aligned while the body reflows between passes. Fallback (`@supports not (anchor-name: --x)`, Firefox until it ships): cards flow statically in the margin in document order with a one-line note. Alternative considered: measure everything and set `top` from `offsetTop` with no anchor positioning. It is one more number per card and works everywhere; take it if Firefox support matters before anchor lands there.

**Popover.** Below the margin breakpoint (reuse the existing `≤960px` rule in `PostEditor`, the split collapses there anyway) the margin is hidden and each mark gets `popovertarget="p{i}"`; the card is the same `SegmentCard`, wrapped in a div with `popover` (auto). Native light-dismiss, `Esc` closes, focus returns to the mark. Position: `position-anchor: --n{i}; top: anchor(bottom); justify-self: anchor-center; position-try-fallbacks: flip-block`. Without anchor positioning the popover is a bottom sheet (`inset: auto 0 0 0`). The Popover API is Baseline 2025; anchor positioning is Chrome 125+ and Safari 26, Firefox pending — the fallbacks above are what a Firefox user gets today.

**`InlineDiff.svelte` vs the first plan.**
- Renders my blocks only. Per placed segment: a mark (button with the underline spans, `aria-describedby` → card id, `aria-label` = kind + block shape) and its card. The card is the existing `SegmentCard` (already shared by `ReferencePane` and `PublishView`), not a new component: the actions go in its `children` snippet as today, and it gains one optional `diff` snippet that, when given, replaces the plain theirs / yours lines with the ins/del or `+`/`−` view. `ReferencePane` and `PublishView` pass no `diff` and do not change. `InlineDiff` wraps each card in a div that carries the `id` and, on narrow, the `popover` attribute, so `SegmentCard` needs no `id` or rest-prop passthrough. Margin `<aside>` or popover is chosen by `matchMedia('(max-width: 960px)')`.
- Needs the measured push pass (`$effect` after render, on `resize`, after `resolved` changes) — about 15 lines the first plan did not have.
- No index column: the margin is the index. On narrow, the ref-head count plus Tab order replace it.
- Size: ~220 lines with CSS, since the card is reused (first plan: ~220). `SegmentCard.svelte` +5. `segment-diff.ts` +40 as before.

**Accessibility.**
- Tab order: marks in document order, each mark followed by its card's two actions (margin: via `aria-flowto` is unreliable; instead `click`/`Enter` on the mark moves focus to the card's primary action, `Shift+Tab` returns). Popover mode: opening moves focus into the popover, `Esc` returns to the mark (native).
- Each mark: `<button type="button">`, `aria-label` naming the kind and the block ("Modified in site: 2 lines in this code block"), `aria-describedby` pointing at the card so a screen reader hears the change text, `aria-expanded` in popover mode. Underline + colour is never the only signal: the label carries the kind.
- Focus ring: 2px outline in the kind colour, offset 3px, `:focus-visible` only. Hover and focus highlight the mark/card pair together.
- Decided marks become inert `<span>`s with the tick, out of the Tab order.
- Margin cards, popovers, the reference pane and the Publish view all render `SegmentCard`, so one set of tests covers all four.

**Risks.**
- Inline `<button>` inside `<p>` / `<h4>` is valid phrasing content; inside `<pre>` it must be `display: block` or the inline button breaks the line boxes (mockup does this). Buttons reset fonts and colours: `all: unset` then re-declare `display`, `cursor`, `border-radius`.
- Word-diff underline on a heavily rewritten paragraph underlines nearly everything; fall back to a whole-block underline when fewer than ~30% of tokens are shared (same cap the first plan uses for ins/del).
- Push-down can move a card far from its mark on dense pages; the active pair highlight and scroll-into-view on focus mitigate. If many segments sit in one screen, the cards variant is the better tool — keep the toggle.
- Anchor positioning inside a `hidden`-toggled container: the push pass must run after the inline view is shown, not on mount.
- Two popovers never coexist (auto); on narrow desktop a long card can cover the next mark — `flip-block` handles the viewport edge, not that.

## log

- 2026-10-04 — margin/popover variant mockup and plan on branch `diff-view-editor-margin`, PR against `diff-view-editor`. Preview copy served from the `_preview` tree: https://mox.xcc.es/_preview/blog-cms/diff-view-editor-margin.html (dark: append `#dark`). Checked in headless Chrome at 1200px light/dark, ~900px with the popover open, 390px, and all-resolved; anchor positioning confirmed working (cards aligned to marks, push-down resolving the three collisions).
- 2026-10-05 — the merge into main took the margin mockup but not this plan; re-landed from `origin/main`. Updated for main: the site-text writer is `site` (was `live`, 1219ace), and the margin/popover card reuses `SegmentCard` (added in cc45292) with one optional `diff` snippet instead of a new card component. Margin mockup labels renamed `live` → `site`; the first mockup still says `live`.
