---
branch: split-page-component
---

# Split `src/routes/+page.svelte`

824 lines: 130 of script, ~180 of markup for three unrelated surfaces, 500 of CSS
for all three. It is the largest file in the repo and every new feature lands in it.

## Seams

- **`src/lib/types.ts`** — `DeployStatus`, `PostListItem`, `Post`, `PublishResult`,
  `PublishData`, plus `pendingStatuses` and `statusLabel`. `DeployStatus` is
  currently declared twice (here and `server/deploy-state.ts`) and `Post` twice
  (here and `PostEditor.svelte`). `deploy-state.ts` imports the type from here so
  there is one definition; `$lib/types` stays client-safe (no server imports).
- **`DeployBadge.svelte`** — the `edit`/status badge pair, duplicated between the
  post list and the recent card, with its own styles.
- **`Sidebar.svelte`** — toggle, new-post form, filters, search, post list,
  publish button, publish result. Owns the publish fetch.
- **`HomePanel.svelte`** — welcome, new-post form, stat tiles, recent grid.

`+page.svelte` keeps the shell grid, the mobile master–detail rules, and the
editor mount.

## Shared state

`filter` and `newTitle` are written from both the sidebar and the home panel, so
they stay in `+page.svelte` and pass down as `$bindable`. `sidebarOpen` and
`query` are sidebar-local. Counts are `$derived` in `+page.svelte` — both children
need them.

## Done when

- `pnpm check` clean, `pnpm build` succeeds
- No behaviour change: filters, search, create, publish, mobile back, sidebar
  collapse all work as before
- `+page.svelte` is the shell only

## Outcome (2026-07-30)

Done in `3d90156`. `+page.svelte` 824 → 129 lines.

| file | lines |
| --- | --- |
| `src/routes/+page.svelte` | 129 |
| `src/lib/components/Sidebar.svelte` | 423 |
| `src/lib/components/HomePanel.svelte` | 212 |
| `src/lib/components/DeployBadge.svelte` | 53 |
| `src/lib/types.ts` | 53 |

`statusLabel()` was deleted rather than moved — all seven branches returned the
input verbatim, so it was an identity function. `statusOf(post)` (`?? 'draft'`)
covers the one thing it actually did.

Verified against the running service at :5273: 100 posts listed, 17 badges,
filter buttons narrow the list, a home stat tile drives the sidebar filter
through `bind:filter`, the sidebar collapses (`.closed` hides the filters), and
selecting a post mounts the editor (37 KB of workbench DOM, Milkdown up, 11
inputs). The paseo webview would not resize below 1280px, so the mobile
master–detail rule was checked in the compiled CSS instead:
`@media (width<=720px){… .shell.has-post.svelte-1uha8ag .sidebar{display:none}}`
— the one `:global()` in the refactor, and it resolves to the child's `<aside>`.
