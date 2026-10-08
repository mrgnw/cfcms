# Changelog

User-visible changes to the CMS, newest first. Add an entry under today's date with every PR merged to main. History before 2026-10-08 is in `git log`.

## 2026-10-08

### Added

- Editor switch in the post header toggles the body editor between Milkdown and Aragonite (spike). The choice is remembered per device.
- With Aragonite active, a Mode dropdown next to the switch picks its presentation mode: live, preview-inline, preview-block, source or reading.

### Fixed

- `/new` returned a 500 under SvelteKit 3: the history link was built from an empty slug. The link now shows only once the post has a slug.
