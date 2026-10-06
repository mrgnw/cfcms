---
title: Diff marks on the live editor, not a separate read-only view
---

Editing takes priority over diff viewing. The read-only Inline diff (`todos/diff-view-editor.md`, mockups `diff-view-editor.html` and `diff-view-editor-margin.html`) stays as a separate view, but it is not the one to invest in. The target is one view: the Milkdown editor stays editable, and the other version's changes appear *on top of it* — marks in the text where edits happened and what kind, with their text and take/keep in the reference-pane column when there is room, in a popover anchored to the mark when there isn't.

What changes versus the read-only plans:

- Marks become ProseMirror decorations over the live doc (`MilkdownEditor.svelte`), not a second rendering of `bodyField`. Decorations map through edits, so positions stay right while typing; the by-content lookup in `applySegment` is still the source for *where* a segment anchors when the doc changes shape.
- The trigger is not the words. Clicking into a marked range must place the caret. Use a gutter glyph beside the block (kind-coloured dot/bar in the left padding) as the `<button>`, plus the underline as a passive signal. Keyboard: a shortcut to jump to the next/previous mark and open its card.
- Margin cards (≥960px) anchor to the decoration's DOM node (`anchor-name` set via decoration attrs), same push-down pass as the margin mockup. Popover (<960px) is `manual`, not `auto`, so typing does not dismiss it; a close button and `Esc` do.
- Taking theirs goes through a ProseMirror transaction on the range, not `setContent`, so undo history and caret survive. Keep `applySegment` as the fallback when the range cannot be mapped.
- Crepe's markdown normalization on `markdownUpdated` is the main risk (orphaned segments); decorations avoid it for placed marks, but a segment whose anchor text was rewritten still needs the "unplaced" card list.

Order: the Publish view diff (`todos/done/1005-diff-view-publish.md`) shipped. The read-only Inline mode is skipped: it would be a second rendering of the body that this view replaces, and its margin mockup already supplied the card design. Decided 2026-10-06, after the apply fix (`todos/done/1006-segment-apply-bugs.md`) made `applySegment` pure and gave runs `afterTheirs`, which the accept-all on a folded run needs. The gutter trigger and the margin-on-live-editor state are mocked up (log below); implementation is next.

## log

- 2026-10-06 — mockup added: `mockups/diff-overlay-on-editor.html` (`#dark` / `#light` pins a theme). It shows the state above on a `contenteditable` body with the caret inside marked words: passive underline/tint on the words, a kind-coloured gutter glyph per change as the only button (dot for words, bar for lines/blocks and the removal range with its count, wedge for content only in site), one card open and the rest collapsed to the glyph, margin cards in the left column (where the reference pane sits) at 1200px (anchored, pushed down, with an expand-all to show the stacking), a `popover="manual"` with close button at ~900px and 390px, the F8 / Shift+F8 next/previous hint, and an unplaced card ("can't place, the text around it changed", with a copy action) at the bottom of the margin and below the body when narrow. Writer label is `site`. Public URL once merged (same pattern as the other mockup): https://mox.xcc.es/blog-cms/diff-overlay-on-editor.html (dark: append `#dark`). Checked in headless Chromium at 1200px and 390px, light and dark.
