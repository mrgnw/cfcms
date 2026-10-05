# xccms

Tiny SvelteKit CMS for editing local Markdown blog content.

## Paths

- App: `~/dev/blog-cms`
- Content source of truth: `~/dev/blog/content`
- Public CMS URL: `https://cms.xcc.es/`

The CMS reads and writes Markdown files under `~/dev/blog/content`.
Saving or creating a post writes the filesystem first, then attempts a git commit as backup/version history.

Override the filesystem base if needed:

```sh
BLOG_CONTENT_BASE_DIR=~/dev/blog
```

## Development

```sh
pnpm dev
```

The dev server uses port `5273` and allows `cms.xcc.es` plus local/tailnet hosts.

## Checks

```sh
pnpm check
pnpm build
```

## Publishing

The CMS exposes `POST /publish` and a Publish view in the UI. Pending changes are staged per post; only staged posts go out.

Publish renders the full live set to `src/posts/<slug>.svx` in the blog checkout (the CMS owns that directory: unstaged posts keep their published revision, unpublished posts are removed), writes the staged posts to `content/*.md`, runs the blog build as a gate, commits, and pushes `main`. Cloudflare Workers Builds deploys the push. The CMS never runs `wrangler`.

The site text is tracked by revision: `published_hash` names the revision each `.svx` was rendered from. A `.svx` edited outside the CMS is picked up when the Publish view loads or a publish starts: if the draft did not move, the site text becomes the new head; if both moved, the post shows as blocked with a `site` version (the text as it is on the site) to resolve per segment.

```sh
BLOG_CONTENT_BASE_DIR=~/dev/blog
BLOG_BUILD_COMMAND='pnpm build'
```

Test the endpoint locally:

```sh
curl -X POST http://localhost:5273/publish
```

## Kagaya Service

Kagaya (`ky`, source at `~/dev/kagaya`) runs local daemons on this machine. This CMS is registered as `blog-cms`.

Check services:

```sh
ky status
```

Restart it after config changes. The service builds before it serves, so the port
takes a few seconds to come up:

```sh
ky restart blog-cms
```

Start it:

```sh
ky start blog-cms
```

Stream logs:

```sh
ky echo blog-cms
```
