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

Order: ship the Publish view diff (`todos/diff-view-publish.md`) and the read-only Inline mode first; then this. Mock up the gutter trigger and the margin-on-live-editor state before implementing.
