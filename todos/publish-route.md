---
title: /publish and /deleted as routes
from: PR #9 (closed), plan section by the diff-view-publish agent, 2026-10-04
---

Today everything is one page: `src/routes/+page.server.ts` loads posts for the sidebar and the view, `+page.svelte` switches on `?view=`. A layout load removes the reason for that.

The catch: SvelteKit content negotiation sends a `POST` to `+server.ts` unless the `Accept` header prioritises `text/html`. `fetch('?/stage', { method: 'POST' })` sends `Accept: */*`, so with `src/routes/publish/+server.ts` still there, clicking a checkbox on `/publish` would run a publish. `+page.server.ts` actions and a `POST` endpoint cannot share the `/publish` directory. Move the endpoint first, in its own commit.

| file | change |
|-|-|
| `src/routes/api/publish/+server.ts` | moved from `src/routes/publish/+server.ts`, unchanged; `PublishView` fetches `/api/publish` |
| `src/routes/+layout.server.ts` | new: `posts`, `postsRev`, `lastPublishedAt` |
| `src/routes/+layout.svelte` | gains the shell grid, `Sidebar`, the 5 s poll, `has-post` from `page.url` (`/publish`, `/deleted`, `?post=`); tokens stay |
| `src/routes/+page.server.ts` | `load` keeps `post` + `versions`; actions keep everything except `stage`/`unstage` |
| `src/routes/+page.svelte` | `PostEditor` or `HomePanel` only |
| `src/routes/publish/+page.server.ts` | new: `load` builds `pendingChanges` from `await parent()`; actions `stage`, `unstage` |
| `src/routes/publish/+page.svelte` | new: `<PublishView changes={data.pendingChanges} lastPublishedAt={data.lastPublishedAt} />` |
| `src/routes/deleted/+page.svelte` | new: `<DeletedView posts={data.posts.filter(p => p.deleteRequested)} />`; no server file |
| `src/lib/ui-state.svelte.ts` | new: `sidebarOpen`, `newTitle`, `filter` as module `$state`; today they are `bind:` props shared by `Sidebar` and `HomePanel` inside one page, and the split puts them in different components |
| `Sidebar.svelte` | `fetch(\`?/${action}\`)` → `/?/${action}` (relative would resolve to `/publish?/queueAdd`); links `/?view=publish` → `/publish`, `/?view=deleted` → `/deleted` |
| `PostEditor.svelte` | `?/save`, `?/dismissVersion` → `/?/save`, `/?/dismissVersion` for the same reason |
| `svelte:head` | title moves into each page |

`DeletedView` stays a component; it already posts to `/?/restore` and `/?/purge` with absolute paths and needs no server data of its own.

### Risks

- The content-negotiation trap above: a missed fetch path is a publish on a checkbox click. Grep `fetch('/publish'` and `'?/` before and after.
- `invalidateAll` reruns the layout `listPosts` on every stage click. Same cost as today.
- Mobile master/detail (`has-post`) now derives from the URL; check `/publish` and `/deleted` at 390px.
- `uiState` module state is per-tab in the browser and must not be read during SSR; `sidebarOpen` defaults to `true` on the server.

### Size

One PR, ~8 files mostly moves. Move the POST endpoint to `src/routes/api/publish/+server.ts` in its own first commit.
