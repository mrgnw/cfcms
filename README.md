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
pnpm test
pnpm build
```

`pnpm test` runs every `src/**/*.check.ts` under `node --test`, then `pnpm check`. `scripts/check-hooks.ts` resolves `$lib` and `$env/dynamic/private` so server modules load in plain node; server checks build a throwaway blog checkout and database under the system temp directory.

## Code blocks

Code blocks in the editor are coloured by twinkleplop, the same highlighter the blog uses, so a block looks the same here as on the site.

Why: Crepe's code blocks are CodeMirror, which ships its own highlighter (lezer) and a One Dark theme. Lezer names tokens differently from twinkleplop, so its colours could only ever approximate the blog's. Instead, `src/lib/code/twinkleplop.ts` runs twinkleplop on the block's text and marks each token with its twinkleplop name (`keyword`, `string`, ...). The blog's stylesheet then colours those names directly. Tokenizing a 500-line block takes about 1 ms, so it reruns on every edit.

Two Crepe details in `MilkdownEditor.svelte`:

- Crepe merges `featureConfigs` into its defaults with lodash `defaultsDeep`. An array is merged entry by entry, so `theme: []` still gets One Dark. The value of `EditorView.theme(...)` is not a plain object, so passing one replaces One Dark. Ours (`theme` in `twinkleplop.ts`) colours the cursor, active line and selection from the same `--twp-*` variables, so they follow light and dark mode. It also sets the blog's code font and size on `.cm-scroller` (CodeMirror's own `monospace` rule there beats `--crepe-font-code`) and hides the gutter: Crepe adds `basicSetup`, whose line numbers the blog does not show.
- The same merge appends Crepe's 143 lezer languages after ours, and those take over aliases such as `bash`. Setting `languages` in a separate `editor.config` call after `new Crepe(...)` replaces the list outright.

### Languages

The picker lists every language twinkleplop has a grammar for except C and C++, the same set the blog highlights (the list mirrors the blog's `mdsvex.config.js`). All grammars are bundled into the CMS build, so nothing loads at runtime. `text`, `lua`, `nginx` and `caddy` are listed too because posts use them, but have no grammar and stay plain, as on the site. Typing a fence such as ```` ```sh ```` followed by a space starts a code block in that language. A fence language not in the list is kept as written and shown as plain text.

### Fence meta

The blog reads extra settings after a fence's language: ```` ```py {2} title="x.py" caption="Run it" ```` (highlighted lines, title, caption). Milkdown's code block keeps only the language, so `src/lib/code/fence-meta.ts` adds a `meta` attribute that is read from the fence and written back unchanged. A block with meta shows it as a small label at its top. Meta can't be typed into a new block in the editor, and highlighted lines are not drawn here; edit the meta in the markdown. `node src/lib/code/fence-meta.check.ts` checks the round trip.

### The `$blog` alias

`svelte.config.js` aliases `$blog` to `BLOG_CONTENT_BASE_DIR` (default `~/dev/blog`)`/src/lib`, so `shell-words.js` and `styles/code-theme.css` are imported straight from the blog checkout rather than copied. Colour changes made there reach the editor the next time this CMS rebuilds (a daemon restart). A missing blog checkout fails the build loudly.

## Publishing

The CMS exposes `POST /api/publish` and a Publish view in the UI. Pending changes are staged per post; only staged posts go out.

Publish renders the full live set to `src/posts/<slug>.svx` in the blog checkout (the CMS owns that directory: unstaged posts keep their published revision, unpublished posts are removed), writes the staged posts to `content/*.md`, runs the blog build as a gate, commits, and pushes `main`. Cloudflare Workers Builds deploys the push. The CMS never runs `wrangler`.

The site text is tracked by revision: `published_hash` names the revision each `.svx` was rendered from. A `.svx` edited outside the CMS is picked up when the Publish view loads or a publish starts: if the draft did not move, the site text becomes the new head; if both moved, the post shows as blocked with a `site` version (the text as it is on the site) to resolve per segment.

```sh
BLOG_CONTENT_BASE_DIR=~/dev/blog
BLOG_BUILD_COMMAND='pnpm build'
```

Test the endpoint locally:

```sh
curl -X POST http://localhost:5273/api/publish
```

## Pitchfork Service

[Pitchfork](https://github.com/jdx/pitchfork) runs local daemons on this machine. This CMS is registered as `global/blog-cms`.

Check services:

```sh
pitchfork list
```

Restart it after config changes. The service builds before it serves, so the port
takes a few seconds to come up:

```sh
pitchfork restart global/blog-cms
```

Start it:

```sh
pitchfork start global/blog-cms
```

Stream logs:

```sh
pitchfork logs global/blog-cms
```
