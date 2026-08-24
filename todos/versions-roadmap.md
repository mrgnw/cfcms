---
branch: writer-chips
---

# Versions & sync roadmap

Design: `mockups/sync-design.html` · concepts settled 2026-08-18

## Progress

- [x] **Conflict-safe saves** — PR #1, merged 2026-08-24. Base-tracked writes (`src/lib/save-rules.ts`), version-on-conflict (sqlite `versions` table), versions as reference-pane tabs with dismiss, adopt-when-clean editor poll (`/api/post`), rev-gated live sidebar (`/api/posts`).
- [ ] **Writer chips + leases** — branch: writer-chips · plan: `docs/superpowers/plans/2026-08-24-writer-chips.md` (gitignored, local). Editable writer chip in the editor header, better iPad default, server lease so two live sessions never share a name (design §8). Replaces the `localStorage.setItem('cms-writer', ...)` console workaround.
- [ ] **Segment-level reconcile** — base-aware 3-way diff in the reference pane: only divergent segments, atomic verbs (added → accept/skip · modified → theirs/yours · removed → confirm/keep), design §4. Also covers: version frontmatter divergence currently invisible; pane snapshot staleness for live-updating versions.
- [ ] **Store-as-truth** — drafts move into sqlite with revisions; `x.md` written at publish only; one-time corpus import; external `.md` edits become an `ext` version. Fixes the pre-existing leading-newline accumulation bug (needs the hash-migration moment). Add the `storedBodyForm`↔`parsePost` round-trip check here.

## Logged edges (non-blocking, triaged)

- Remote purge while another device is typing can drop ≤1.2 s of unsaved keystrokes.
- Duplicated Safari/Chrome tabs share `sessionStorage` (same session id); leases don't fix this — two duplicated tabs are genuinely one session.
- `/api/posts` tick runs `listPosts` (~120 file reads + small sqlite txn) per visible tab every 5 s; revisit if tabs multiply.
- Dismiss button has no in-flight disabled state (double-click sends two idempotent deletes).
- Delete the demo post `sync-demo.md` (and its version rows) when done poking the UI.
- Migrate the `blog-cms` service from ky (legacy) to pitchfork — separate chore.
