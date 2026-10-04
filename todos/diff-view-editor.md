---
title: Integrated diff view in the post editor
---

The reference pane shows versions (`live`, `llm`, `ext`, other writers) as segment cards: each card quotes the other text, a `replaces: …` line quotes mine, and offers take theirs / keep mine. That loses position — you cannot see where in the post a segment sits, what surrounds it, or how much of the document changed. A segment that "replaces: ### 2. Create `serve.json`" with a paragraph about `network_mode` is a heading-vs-paragraph misalignment the card view cannot show.

Plan and mock up a toggleable **integrated diff view** in `PostEditor`: the post body rendered once, with the other version's changes shown inline (added / removed / modified spans or blocks in place), and per-change accept/keep actions kept at the change. Toggle between the current card list and the inline view; the card list stays for small, isolated changes.

Deliverables:
- `mockups/diff-view-editor.html` — static mockup, light and dark, using the app tokens (see `src/lib/styles` or `src/app.css` and `mockups/sync-design.html` for the existing design language). Show: toggle, inline added/removed/modified, a heading-level change, a code block change, the per-change actions, and the "all resolved" state. Serve via dmox (`dmox url mockups/diff-view-editor.html`) and put the public URL in the todo log.
- A short plan appended to this file: data needed from `src/lib/segment-diff.ts` (does `Segment` carry enough position info? probably needs block index/offsets), what changes in `ReferencePane.svelte` vs `PostEditor.svelte`, how apply-segment stays identical, risks with the Milkdown editor surface.

Do not implement the component. Plan + mockup only. Follow the `design` and `design-data` skills.
