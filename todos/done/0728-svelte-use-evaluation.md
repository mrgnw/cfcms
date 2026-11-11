---
agent: true
branch: gullible-pony
---

# Evaluate svelte-use for cfcms

## Outcome (2026-07-28)

Dependency **not** added. `runed` is already installed and ships no clipboard
utility, so the one candidate site had no in-house replacement either — it stays
hand-rolled, which is ~8 lines. Item 1 of the recommendation is done: the copy
button now awaits the write, keeps the green state for real successes only, and
shows a red state plus a `role="status"` message on failure.

Survey finding from the cross-project [@ariefsn/svelte-use](https://github.com/ariefsn/svelte-use) scan (2026-07-28). Every other Svelte repo got a GitHub issue; this one got a todo instead because the surface is genuinely thin.

## What the scan found

Exactly one candidate site in the whole repo:

- `src/lib/components/ReferencePane.svelte:45` — `navigator.clipboard?.writeText(markdown).catch(() => {})`, fire-and-forget with no copied-state feedback. → `useClipboard`

No `localStorage`, no manual `setInterval`, no `ResizeObserver`/`IntersectionObserver`/`MutationObserver`, no hand-rolled debounce, no raw `WebSocket`, no `matchMedia`. This repo does not hand-roll browser plumbing.

## Recommendation

**Do not add the dependency for one clipboard call.** One composable does not justify a new dep — especially a young one (v1.1.0, single maintainer, last commit 2026-03-18).

Two things worth doing regardless of the library:

1. The `.catch(() => {})` swallows failures silently. If the copy fails (permissions, insecure context, no clipboard API), the user gets no feedback at all and no way to know. Add a copied/failed state to the button either way.
2. Revisit this if cfcms grows editor features — autosave, drag-to-reorder, live preview panes, or file drop would each pull in several composables at once and change the maths.

## Related

- Pilot repos proving the library out: `mrgnw/svelte.barcelona#7`, `mrgnw/morganwill.com#9`
- Blocked-on-pilot: `mrgnw/anani#344`, `mrgnw/jobs#64`, `mrgnw/bits#3`
- Rule for repos that already ship `runed`: runed wins any overlap; svelte-use fills gaps only.
