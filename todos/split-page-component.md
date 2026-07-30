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
