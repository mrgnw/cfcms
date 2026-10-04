# Publish progress and scheduling

Logged 2026-10-04 after the publish pipeline moved to render `src/posts/*.svx` → build gate → commit → push `main` (Cloudflare Workers Builds deploys the push).

- Poll Cloudflare Workers Builds after the push and show build state in the Publish view; today "ok" means the push landed, not that the site rebuilt.
- Stream build output while `pnpm build` runs instead of returning the tail at the end.
- Scheduled publish: stage now, go out at a chosen time.
- `renderSvx` normalizes frontmatter quoting; the first real publish rewrites all 13 `.svx` frontmatters (bodies untouched, verified 2026-10-04 on a throwaway branch).
- A "take live text" action on the `live` version pane, so a post whose site text is newer than the CMS draft can adopt it in one click.
