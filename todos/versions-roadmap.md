---
branch: segment-reconcile
---

# Versions & sync roadmap

Design: `mockups/sync-design.html` · concepts settled 2026-08-18

## Progress

- [x] **Conflict-safe saves** — PR #1, merged 2026-08-24. Base-tracked writes (`src/lib/save-rules.ts`), version-on-conflict (sqlite `versions` table), versions as reference-pane tabs with dismiss, adopt-when-clean editor poll (`/api/post`), rev-gated live sidebar (`/api/posts`).
- [x] **Writer chips + leases** — PR #2, merged 2026-08-24. Editable writer chip, iPad default via `maxTouchPoints`, `leases` table (40 s grace), granted name adopted from save responses.
- [ ] **Segment-level reconcile** — implemented on branch segment-reconcile, PR open (awaiting merge). Base-aware 3-way diff (`src/lib/segment-diff.ts`, move-immune, 500-block cap), base recovered from git by 50-rev hash walk, segment cards with atomic verbs in the pane, frontmatter field take/keep, pane keyed on `id:updatedAt`. Bonus fix found by e2e: CRLF normalized at the save boundary (git `text=auto` was desyncing blob hashes from working-tree hashes, breaking base recovery for browser-typed posts). Plan: `docs/superpowers/plans/2026-08-24-segment-reconcile.md` (gitignored, local).
- [ ] **Store-as-truth** — drafts move into sqlite with revisions; `x.md` written at publish only; one-time corpus import; external `.md` edits become an `ext` version. Fixes the pre-existing leading-newline accumulation bug (needs the hash-migration moment). Add the `storedBodyForm`↔`parsePost` round-trip check here.

## Logged edges (non-blocking, triaged)

- Remote purge while another device is typing can drop ≤1.2 s of unsaved keystrokes.
- Duplicated Safari/Chrome tabs share `sessionStorage` (same session id); leases don't fix this — two duplicated tabs are genuinely one session.
- `/api/posts` tick runs `listPosts` (~120 file reads + small sqlite txn) per visible tab every 5 s; revisit if tabs multiply.
- Dismiss button has no in-flight disabled state (double-click sends two idempotent deletes).
- Delete the demo post `sync-demo.md` (and its version rows) when done poking the UI.
- Migrate the `blog-cms` service from ky (legacy) to pitchfork — separate chore.
