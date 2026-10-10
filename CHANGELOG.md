# Changelog

User-visible changes to the CMS, newest first. Add an entry under today's date with every PR merged to main. History before 2026-10-05 is in `git log`.

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
