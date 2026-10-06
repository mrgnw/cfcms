---
title: Applying a segment can misplace or silently drop the change
---

Found while planning the inline diff (`todos/diff-view-editor.md`, margin variant). All three reproduce today in the Cards view. `applySegment` in `PostEditor.svelte` places a segment by content, and each card resolves on click whether or not the apply did anything.

Repro, with base = main = `Alpha.` then `Omega.`:

1. **Consecutive added blocks land reversed.** The version is `Alpha.`, `One.`, `Two.`, `Three.`, `Omega.`, and you accept the three cards top to bottom. The result is `Alpha.`, `Three.`, `Two.`, `One.`, `Omega.`. `diffSegments` gives every block of a new run the same `afterMain` (`Alpha.`), and `applySegment` inserts at anchor + 1.
2. **A rewritten anchor puts an added block at the top of the post.** The user edits `Alpha.` to `Alpha, edited.`, then accepts `One.`. The result is `One.`, `Alpha, edited.`, `Omega.`. `indexOf` returns -1 for the missing `afterMain`, and -1 + 1 is the first position. `conflict` takes the same path.
3. **A rewritten target is a silent no-op, and the card still resolves.** The version drops `Alpha.`, the user has since edited it, and they click "remove it". The body is unchanged and the card disappears. `modified` behaves the same way, so "take theirs" can lose their text without a trace.

Fix:

- Move `applySegment` into `src/lib/segment-diff.ts` as a pure `applySegment(body, segment): string | null`. Return `null` when the segment cannot be placed: the target is missing, or a non-null `afterMain` is missing. `PostEditor` calls it and runs `replaceBody` on success. The pure version makes the three repro cases checkable in `segment-diff.check.ts`.
- Resolve the card only on success. On `null`, keep the card, mark it "can't place, the text around it changed", and offer copy.
- For runs, have `diffSegments` add `afterTheirs`: the previous version block in the same inserted run, `null` for the first. Apply tries `afterTheirs` first and falls back to `afterMain`. Accepting in any order then keeps the run's order, and skipping one block still works. The inline view's accept-all on a folded run goes through the same path.

Other loose ends from the same work:

- `mockups/diff-view-editor.html` still labels the site-text writer `live`. It was renamed to `site` in 1219ace; the margin mockup is already updated.
