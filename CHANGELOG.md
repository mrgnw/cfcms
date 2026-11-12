# Changelog

User-visible changes to the CMS, newest first. Add an entry under today's date with every PR merged to main. History before 2026-10-05 is in `git log`.

## 2026-11-12

### Changed

- The roadmap names the main direction: publish to Cloudflare storage that the blog's Worker reads, instead of storing published posts in the blog repository.
- The README now documents where posts live (SQLite tables, published files), how to inspect and restore the database, and the daily backup. It also says Aragonite is the default editor.

## 2026-11-11

### Changed

- Aragonite is on 0.11.5, now licensed MPL-2.0 instead of AGPL-3.0. Its details, footnotes, mermaid and slash-command plugins come from their own packages.

## 2026-10-17

### Added

- A ` ```mermaid ` block in the editor renders as a diagram, drawn by pele, the same renderer the blog uses. Colours follow the CMS light and dark theme.
- Diagrams are laid out for the blog's 560px post column, so a wide flowchart turns top-down here just as it does on the blog.

## 2026-10-10

### Changed

- The post list filters are now a Drafts › Ready → Publish → Live stepper. Publish sits between Ready and Live instead of in the footer. Tap a stage again to show all posts.
- Post rows show a status dot, the title and a short date on one line. Tags and the full date are gone from the list.
- The home page uses the same stepper and status dots as the post list, in place of its All/Drafts/Ready/Live count cards and status pills.
- On phones the whole page scrolls, so nothing is hidden under the Safari bar. Long-press an editing-queue post to reorder it. Remove it from the queue in the editor.

## 2026-10-09

### Changed

- Aragonite is now the default body editor. A device that picked Milkdown with the editor switch keeps it.

### Added

- Every device records keystrokes that take more than 50 ms to appear, with the frames and requests around them, to `.data/lag.jsonl` on the server. It is there to catch the intermittent typing lag.

## 2026-10-08

### Added

- Editor switch in the post header toggles the body editor between Milkdown and Aragonite (spike). The choice is remembered per device.
- With Aragonite active, a Mode dropdown next to the switch picks its presentation mode: live, preview-inline, preview-block, source or reading.

### Changed

- Upgraded to SvelteKit 3.

### Fixed

- `/new` returned a 500 under SvelteKit 3: the history link was built from an empty slug. The link now shows only once the post has a slug.

## 2026-10-07

### Added

- `/new` replaces the sidebar title box with the full editor. The post is created on its first save with real content, then the editor moves to the post's own URL (#37).
- Opening a standalone `.llm.md` draft from the sidebar imports it and opens the new post. `/admin` lists every `.llm.md` draft with per-draft and bulk import (#42).

### Changed

- In the sidebar queue, only the grip handle starts a drag.

### Fixed

- `/posts/{slug}` and `/new` no longer die client-side with a 500: `node:crypto` stays out of the browser bundle.

## 2026-10-06

### Added

- Per-post history page to browse, name and restore revisions.
- Named revisions survive the 200-autosave prune.

### Fixed

- Accepting change cards: an inserted run accepted top to bottom no longer comes out reversed, and a block whose anchor was rewritten no longer jumps to the top. When a card can't be placed, it stays open, says the surrounding text changed and offers copy instead of silently doing nothing.

## 2026-10-05

### Added

- Every post has a short id, and `/p/{id}` routes to it.
- Posts live at `/posts/{slug}`. `/publish` and `/deleted` are full pages; the publish endpoint moved to `/api/publish`.
- New standalone `.llm.md` drafts are imported as CMS posts automatically, and the home panel can bulk-import all of them.
- Editor code blocks match the blog: twinkleplop highlighting with every grammar bundled, IBM Plex Mono at the blog's size, no line numbers, and inline code styled like the blog.
- The code language picker covers every fence language the blog's posts use.
- Code fence meta shows as a label above the block.

### Changed

- Publishing also commits the icons the blog build vendors into `src/lib/icons`.

### Fixed

- Saving a post keeps code fence meta.
- Publishing refuses to run when the blog checkout isn't on main.
