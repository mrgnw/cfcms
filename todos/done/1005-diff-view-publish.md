---
title: Integrated diff view in the Publish view, and /publish as a route
pull-request: 20
outcome: rows expand into the editor segment cards (PR #20); the line-hunk design in PR #9 was not taken; route split carried to todos/publish-route.md
---

The Publish view (`src/lib/components/PublishView.svelte`, reached as `/?view=publish`) lists pending changes with +/- counts and a tiny bar. There is no way to see *what* changed without opening the post. Plan and mock up a toggleable **integrated diff** per pending row: expand a row to show the published revision vs the head inline (added / removed / modified in place), so a change can be reviewed and staged from the Publish view.

Also make `/publish` a real route. Today everything is one page (`src/routes/+page.server.ts` loads posts for the sidebar and the view, `+page.svelte` switches on `?view=`). Plan the move: sidebar data to `src/routes/+layout.server.ts`, `src/routes/publish/+page.server.ts` for pending changes, `?view=deleted` the same way. Note the existing `src/routes/publish/+server.ts` (POST endpoint) — a `+page.server.ts` can live beside it; check SvelteKit rules for `+server.ts` and `+page*` in one directory.

Deliverables:
- `mockups/diff-view-publish.html` — static mockup, light and dark, app tokens (see `src/lib/styles` or `src/app.css` and `mockups/sync-design.html`). Show: the row list with staging checkboxes as it is now, one row expanded into inline diff, an unpublish/delete row, the publish button state, and how a `live`-version block (staging refused) looks. Serve via dmox (`dmox url mockups/diff-view-publish.html`) and put the public URL in the todo log.
- A short plan appended to this file: data shape the server should return per row (whole-body diff? `lineDiffCounts` already exists in `src/lib/segment-diff.ts`), the route split, what happens to `DeletedView`, risks.

Do not implement. Plan + mockup only. Follow the `design` and `design-data` skills.
