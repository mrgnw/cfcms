# Roadmap

cfcms is a one-writer CMS for a blog hosted on Cloudflare Workers. It edits the content and publishes it; the blog is a separate project that only displays it. SvelteKit on Workers is the primary target, and the publish contract is meant to stay plain enough for other frameworks. It is not a multi-user CMS.

Work that is ready to pick up is tracked as [GitHub issues](https://github.com/mrgnw/cfcms/issues). Each has acceptance criteria and is sized at a few hours.

## Shipped

- Conflict-safe saves: base-tracked writes, versions on conflict, adopt-when-clean polling.
- Writer chips and leases, so two devices editing the same post see each other.
- Segment-level reconcile: three-way diff with take or keep per segment.
- Store-as-truth: drafts live in SQLite with a bounded revision history; Markdown files are the boundary and are ingested on change.
- Publish pipeline: staged posts render to `src/posts/<slug>.svx`, the blog build gates the commit, then it pushes `main`.
- Diff view in the Publish view.
- `.llm.md` draft import, single and bulk, from `/admin`.

Design notes for these live in [mockups/sync-design.html](mockups/sync-design.html).

## Direction: published posts live in Cloudflare storage, not in the blog repo

Today Publish commits `.svx` files to the blog's git repository and waits for a Workers Build, so the articles sit inside the blog's code and every edit needs a deploy. The key direction for cfcms is the opposite: the CMS holds the content, Publish writes it to Cloudflare storage that the blog's Worker reads at request time, and the blog repo holds only code. A published edit goes live without a rebuild, and the Worker can cache, paginate and optimise from the store. Git publishing stays as a second target. Not started; the design decision comes first.

Tracked in [#19](https://github.com/mrgnw/cfcms/issues/19):

1. [#25](https://github.com/mrgnw/cfcms/issues/25) Design: where published posts live, and what a stored post contains.
2. [#20](https://github.com/mrgnw/cfcms/issues/20) A publish target interface, with git as the first implementation.
3. [#21](https://github.com/mrgnw/cfcms/issues/21) Cloudflare storage target.
4. [#22](https://github.com/mrgnw/cfcms/issues/22) A Worker reader for SvelteKit and an example app.
5. [#23](https://github.com/mrgnw/cfcms/issues/23) A published edit is live without a deploy.
6. [#24](https://github.com/mrgnw/cfcms/issues/24) One-time import of git-published posts into the store.

## Next: edit with the diff on top

One view instead of a separate read-only diff: the editor stays editable and the other version's changes are drawn over it. The design is in [mockups/diff-overlay-on-editor.html](mockups/diff-overlay-on-editor.html).

1. [#15](https://github.com/mrgnw/cfcms/issues/15) Draw changes as editor decorations.
2. [#1](https://github.com/mrgnw/cfcms/issues/1) Margin cards, popover and transactional accept.

## Next: links between posts

Posts link to each other by slug today, so links to drafts and renamed posts ship broken. Plan: lint first, then `post:<id>` references resolved at publish, then editor support.

1. [#2](https://github.com/mrgnw/cfcms/issues/2) Lint internal links that point at non-live posts.
2. [#3](https://github.com/mrgnw/cfcms/issues/3) `post:<id>` references resolved at publish.
3. [#4](https://github.com/mrgnw/cfcms/issues/4) Post picker and paste conversion in the editor.

Later, only if a second post needs it: an `after:` frontmatter dependency, and block conditionals ("when that post is live").

## Next: publishing

- [#5](https://github.com/mrgnw/cfcms/issues/5) Show Cloudflare Workers Builds state after the push.
- [#6](https://github.com/mrgnw/cfcms/issues/6) Stream build output while the gate runs.
- [#7](https://github.com/mrgnw/cfcms/issues/7) Lock concurrent publishes and catch edits after staging.
- [#8](https://github.com/mrgnw/cfcms/issues/8) Refuse to purge a live post without confirmation.
- [#9](https://github.com/mrgnw/cfcms/issues/9) Scheduled publish.
- [#10](https://github.com/mrgnw/cfcms/issues/10) Detect `.svx` deletions and frontmatter-only edits on the site.

## Next: tests and structure

- [#11](https://github.com/mrgnw/cfcms/issues/11) Cover the filesystem boundary in `content.ts`.
- [#12](https://github.com/mrgnw/cfcms/issues/12) Remote functions for queue actions and a `PostList` component.
- [#13](https://github.com/mrgnw/cfcms/issues/13) Standalone `.llm.md` read-only instead of a 500.
- [#14](https://github.com/mrgnw/cfcms/issues/14) Roll back failed transactions and lower the diff size cap.

## Known edges, not scheduled

- A remote purge while another device is typing can drop up to 1.2 s of unsaved keystrokes.
- Duplicated browser tabs share `sessionStorage`, so they share a session id.
- Every visible tab runs `listPosts` on a 5 s tick; revisit if tabs multiply.
- The Dismiss button has no in-flight state, so a double click sends two idempotent deletes.
- A second external edit to a post bases on the first edit's file hash, which matches no revision, so it shows a whole-body pane instead of segments.
- `git ls-files` quotes non-ASCII paths, which would drop such a path from the import deletion commit.
- `PostSummary.baselineCommit` is dead code.
- Long-press queue reorder on a phone is untested on real hardware.
- Re-evaluate the `svelte-use` dependency if autosave, live preview or file drop arrive; `runed` covers the current needs.

## Non-goals

- Multi-user editing or auth. It is for one writer on a machine they trust.
- A plugin system, a theme system, or config for values that never change.
