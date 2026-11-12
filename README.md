# cfcms

A Markdown editor for the posts of a static blog. Write in the browser, keep drafts and version history in SQLite, then publish the staged posts to the blog's repository, where Cloudflare Workers Builds deploys them. The planned direction is to publish to Cloudflare storage that the blog's Worker reads directly, so the articles are not stored in the blog repository and an edit goes live without a rebuild; see the [roadmap](ROADMAP.md).

It is built for one writer who keeps a blog as Markdown in a git checkout and wants a better editing surface than a text editor, on a laptop or a phone. It is a single-user tool: there is no auth, and it expects to run on a machine you trust.

Built with SvelteKit 3 and Svelte 5, [Aragonite](https://github.com/voithos-labs/aragonite) for editing (with [Milkdown Crepe](https://milkdown.dev) as an alternative), [twinkleplop](https://www.npmjs.com/package/@twinkleplop/core) for code highlighting, and `node:sqlite` for storage. TypeScript throughout, tested with `node --test`.

## Features

- WYSIWYG Markdown editing with the blog's own code highlighting, including fence titles, captions and highlighted-line meta.
- Autosave to a SQLite store with a bounded revision history per post; conflicting saves from two devices become versions to reconcile segment by segment.
- Stages: drafts, ready, publish, live. Pending changes are staged per post and published together.
- Publish renders posts to `.svx` files in the blog checkout, runs the blog build as a gate, then commits and pushes.
- Import of `.llm.md` drafts written by an assistant, shown as a reference pane to copy from.

## Run it

You need Node 24 or newer and [pnpm](https://pnpm.io) 10 (the version CI uses).

```sh
git clone https://github.com/mrgnw/cfcms.git
cd cfcms
pnpm install
```

To try it without a blog of your own, run it against a throwaway copy of the sample posts in `content/posts`. The editor writes into the folder it points at, so do not point it at this repository:

```sh
DEMO=$(mktemp -d)
mkdir -p "$DEMO/content"
cp -R content/posts "$DEMO/content/"
git -C "$DEMO" init
BLOG_CONTENT_BASE_DIR="$DEMO" BLOG_CMS_DB="$DEMO/cms.db" pnpm dev
```

Then open http://localhost:5273.

The first request runs a one-time import that changes the folder it points at, which is why it must be a disposable copy. It moves every `content/*.md` post into the database and deletes the files of posts that were never published (here, all of them). It also commits those deletions, writes `.cms/cms-backup.db`, commits that backup and tries `git push origin main`. With no `origin`, as in the demo, the push fails and the failure is ignored. The demo has no blog build and no remote, so it shows the editor, not publishing.

To edit a real blog, keep its checkout next to this one at `../blog` (or set `BLOG_CONTENT_BASE_DIR`). The checkout holds posts in `content/` and gets rendered `.svx` files in `src/posts/`:

```sh
pnpm dev
```

For a production build:

```sh
pnpm build
node --env-file=.env build/index.js
```

## Configuration

Copy `.env.example` to `.env` and change what you need. Everything has a default.

| Variable | Default | Purpose |
|-|-|-|
| `BLOG_CONTENT_BASE_DIR` | `../blog` | Blog checkout: posts in `content/`, rendered output in `src/posts/`. |
| `BLOG_CMS_DB` | `.data/cms.db` | SQLite database. |
| `BLOG_BUILD_COMMAND` | `pnpm build` | Build gate run in the blog checkout before a publish is committed. |
| `BLOG_CMS_DEPLOY_STATE_FILE` | `<blog>/.cms/deploy-state.json` | Legacy deploy state, read once on upgrade. |
| `PORT` | `5273` | Dev and production port. |
| `HOST` | `localhost` | Bind address. |
| `ALLOWED_HOSTS` | none | Extra hostnames the dev server accepts, comma separated (a tunnel or tailnet name). |
| `ORIGIN` | none | Public URL when served behind a proxy; needed for form posts to pass the CSRF check. |
| `HMR_CLIENT_PORT` | none | Set to `443` when the dev server is behind an HTTPS proxy. |

## Where the posts live

Posts are stored in SQLite, not in the blog repository. The blog repository only receives published output.

| What | Where |
|-|-|
| Working text of every post, with its revision history | `revisions` table in the database |
| Text two devices saved at the same time, waiting to be reconciled | `versions` table |
| Publish state per post (published hash, slug, commit, editing order) | `posts` table |
| Which writer and device is active | `leases` table |
| App flags such as the last backup time | `meta` table |
| Published posts | `src/posts/<slug>.svx` in the blog checkout, written by Publish |
| Staged posts | `content/*.md` in the blog checkout, written by Publish |
| Drafts written by an assistant | `content/*.llm.md`, read from disk and imported as reference |

The database is created on the first request at `BLOG_CMS_DB` (default `.data/cms.db`). On first run it imports the existing `content/*.md` files into it. `.data/` is ignored by git, so the database is never committed to this repository.

Autosave appends a revision. Each post keeps its latest 200 unnamed revisions, plus named checkpoints, the revision that was published and any revision a pending version is based on. Older autosaves are pruned.

To look inside, take a snapshot so the running CMS is never touched. The database runs in WAL mode, so a plain `cp` of an active database can miss recent writes; `VACUUM INTO` makes a consistent copy:

```sh
DB=.data/cms.db
SNAPSHOT=/tmp/cfcms-inspect.db
rm -f "$SNAPSHOT"
sqlite3 "$DB" "VACUUM INTO '$SNAPSHOT'"
```

```sh
sqlite3 /tmp/cfcms-inspect.db "SELECT path, published_slug, published_at FROM posts ORDER BY published_at DESC LIMIT 10"
```

```sh
sqlite3 /tmp/cfcms-inspect.db "SELECT rev, writer, saved_at, length(body) FROM revisions WHERE path = (SELECT path FROM posts LIMIT 1) ORDER BY rev DESC LIMIT 10"
```

The schema is created in `src/lib/server/db.ts`, which also adds new columns to older databases on open, so an existing database upgrades in place.

### Backups

About once a day the CMS writes a compacted copy of the database (`VACUUM INTO`) to `.cms/cms-backup.db` in the blog checkout, commits it with the message `cms: db backup`, and pushes. That copy holds every draft and revision, so keep the blog repository private, or ignore `.cms/` in it, if drafts must not become public.

To restore, stop the CMS, copy a backup over the database file, and start it again. Remove the old `-wal` and `-shm` files first, or SQLite may replay them into the restored database:

```sh
BLOG=../blog
rm -f .data/cms.db-wal .data/cms.db-shm
cp "$BLOG/.cms/cms-backup.db" .data/cms.db
```

## Checks

```sh
pnpm test
pnpm build
```

`pnpm test` runs every `src/**/*.check.ts` under `node --test`, then `pnpm check`. `scripts/check-hooks.ts` resolves `#lib` and `$app/env/private` so server modules load in plain node; server checks build a throwaway blog checkout and database under the system temp directory. CI runs the same two commands.

## Roadmap

See [ROADMAP.md](ROADMAP.md) and the [open issues](https://github.com/mrgnw/cfcms/issues). User-visible changes are in [CHANGELOG.md](CHANGELOG.md).

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

The `sveltekit(...)` plugin in `vite.config.ts` aliases `$blog` to `src/lib` of your blog checkout, so `shell-words.js` and `styles/code-theme.css` are imported straight from it rather than copied. Colour changes made there reach the editor the next time the CMS rebuilds. Without a checkout (or one with no `src/lib`), the alias falls back to the copies in `src/blog-defaults`, which is what CI and the demo above use. The choice is all or nothing: if the checkout has a `src/lib` at all, both files must exist there, otherwise the build fails to resolve them.

## Editors

The button left of the writer chip in a post's header switches the body editor between [Aragonite](https://github.com/voithos-labs/aragonite) (the default, MPL-2.0) and Milkdown. The choice is remembered per browser. Both editors read and write the same body, so switching mid-edit keeps your text.

Aragonite saves what it loaded byte for byte. The code is in `src/lib/components/AragoniteEditor.svelte`, with plugins in `src/lib/aragonite/plugins.ts`. Its code blocks use Aragonite's own highlight.js colours rather than twinkleplop, so they won't match the blog. A Mode menu above it switches between Aragonite's presentation modes (`live` is closest to Milkdown).

## Publishing

The CMS exposes `POST /api/publish` and a Publish view in the UI. Pending changes are staged per post; only staged posts go out.

Publish renders the full live set to `src/posts/<slug>.svx` in the blog checkout (the CMS owns that directory: unstaged posts keep their published revision, unpublished posts are removed), writes the staged posts to `content/*.md`, runs the blog build as a gate, commits, and pushes `main`. Cloudflare Workers Builds deploys the push. The CMS never runs `wrangler`.

The site text is tracked by revision: `published_hash` names the revision each `.svx` was rendered from. A `.svx` edited outside the CMS is picked up when the Publish view loads or a publish starts: if the draft did not move, the site text becomes the new head; if both moved, the post shows as blocked with a `site` version (the text as it is on the site) to resolve per segment.

The blog build command defaults to `pnpm build` and runs in the blog checkout; set `BLOG_BUILD_COMMAND` to change it. To trigger a publish from a script:

```sh
curl -X POST http://localhost:5273/api/publish
```

## License

[MIT](LICENSE)

