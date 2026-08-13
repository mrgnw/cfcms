# xccms — plan

Tiny SvelteKit CMS for the Markdown content in `~/dev/blog/content`. Runs
as the `blog-cms` kagaya service on :5273, served at https://cms.xcc.es/.

The editor features and the production serving setup have landed. What is left is
mostly structural: the code grew faster than its seams.

## Now

1. **Publish result surface.** `publish/+server.ts` is 14 lines; the UI shows a
   pass/fail `<details>` per target but drops `r.output` unless it contains a
   deploy URL. A failed `wrangler deploy` therefore shows "failed" with no reason.
   Show the tail of `output` on failure.

2. **Tests on the content path.** `blocks.check.ts` is the only check in the repo.
   `frontmatter.ts` (parse/serialize, 103 lines) and `content.ts` (229 lines,
   writes files under the blog checkout) have none. One assert-based check each,
   in the style of `blocks.check.ts` — the frontmatter round-trip is the valuable
   one, since a parse bug silently rewrites a real post.

## Later

3. **Re-evaluate `svelte-use`.** The 2026-07-28 survey declined the dependency at
   one candidate site, and named the condition to revisit: autosave, drag-to-reorder,
   live preview, file drop. Drag-to-reorder shipped in `8e39ba7`, so the count is
   climbing. `runed` still wins any overlap. See
   [todos/done/0728-svelte-use-evaluation.md](todos/done/0728-svelte-use-evaluation.md).

## Upstream

`ky restart` does not honour `depends_on`. `start_one_service` waits for each
dependency (`crates/kagaya/src/bin/kagaya/plist_sync.rs:921-960`), but
`restart_one_service` (`:1043-1057`) just restarts every unit back to back with
no barrier. Separately, `unit_ready` calls a `type = "task"` ready when it is
*not running* (`:1106-1108`), which is also true in the window before launchd has
spawned it — so a barrier alone would still pass instantly. launchd exposes
`runs = N` in `launchctl print`, which would distinguish "not started yet" from
"finished".

This repo no longer depends on either behaviour, but other kagaya services with
`depends_on` still do.

## Non-goals

- Multi-user, auth, or remote content. This edits local files on one Mac mini.
- A plugin system, a theme system, or config for values that never change.
