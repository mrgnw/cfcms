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
SVELTE_BLOG_DIR=~/dev/blog-loke
ASTRO_BLOG_DIR=~/dev/blog-astro
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

The CMS exposes `POST /publish` and a publish button in the UI. Publishing runs local build/deploy commands for the configured targets against the Mac mini filesystem checkouts. It also attempts `git push` as a backup/version-control step, but deploy success is determined by the local deploy commands, not git.

Configure these private runtime environment variables:

```sh
SVELTE_BLOG_DIR=~/dev/blog-loke
SVELTE_BLOG_DEPLOY_COMMAND='bun run build && bunx wrangler deploy'
ASTRO_BLOG_DIR=~/dev/blog-astro
ASTRO_BLOG_DEPLOY_COMMAND='pnpm build && pnpm deploy'
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
