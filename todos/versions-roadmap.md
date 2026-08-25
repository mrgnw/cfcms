---
branch: store-as-truth
---

# Versions & sync roadmap

Design: `mockups/sync-design.html` · concepts settled 2026-08-18

## Progress

- [x] **Conflict-safe saves** — PR #1, merged 2026-08-24. Base-tracked writes (`src/lib/save-rules.ts`), version-on-conflict (sqlite `versions` table), versions as reference-pane tabs with dismiss, adopt-when-clean editor poll (`/api/post`), rev-gated live sidebar (`/api/posts`).
- [x] **Writer chips + leases** — PR #2, merged 2026-08-24. Editable writer chip, iPad default via `maxTouchPoints`, `leases` table (40 s grace), granted name adopted from save responses.
- [x] **Segment-level reconcile** — PR #3, merged 2026-08-24. Three-way diff (`src/lib/segment-diff.ts`), git base recovery, segment cards with atomic verbs, field take/keep, CRLF save-boundary normalization (found by e2e: git `text=auto` desynced blob hashes).
- [x] **Store-as-truth** — PR #4. Drafts live in sqlite (`revisions` table, cap 200/post with published + version-base anchors); `savePost` writes the store, no per-save file write or git commit; boundary files ingest on the existing tick (new `x.md` → import, changed `x.md` → `ext` version, changed `.llm.md` → `llm` version); `runPublish` renders pending posts to `x.md` in one commit; sqlite backup (`VACUUM INTO` → `.cms/cms-backup.db`) daily + after publish; one-time corpus import fixed the leading-newline parser bug and recomputed published hashes.

## Logged edges (non-blocking, triaged)

- Remote purge while another device is typing can drop ≤1.2 s of unsaved keystrokes.
- Duplicated Safari/Chrome tabs share `sessionStorage` (same session id); leases don't fix this — two duplicated tabs are genuinely one session.
- `/api/posts` tick runs `listPosts` (~120 stats, reads only on mtime change) per visible tab every 5 s; revisit if tabs multiply.
- Dismiss button has no in-flight disabled state (double-click sends two idempotent deletes).
- Migrate the `blog-cms` service from ky (legacy) to pitchfork — separate chore.

## Store-as-truth follow-ons (logged, non-blocking)

- `ext` re-edit base drift: a second external edit bases on the first edit's file hash, which matches no revision → whole-body pane instead of segments.
- `lineDiffCounts` cap of 4000 lines allocates a ~64 MB LCS table; 1500 would keep it under 10 MB.
- A standalone `.llm.md` is editable in PostEditor but `savePost` rejects it — autosave surfaces repeated 500s. Gate read-only or return `fail(400)`.
- `deletePostRows` has BEGIN/COMMIT without try/ROLLBACK (same as `removeFromEditing`/`recordPublished` — fix all three together).
- `PostSummary.baselineCommit` is dead since `diffNumstat` was deleted.
- `git ls-files` quotes non-ASCII paths, which would drop such a path from the import deletion commit (corpus is ASCII).
- Import report writes to `.data/import-report.md`; the design doc says `.superpowers/sdd/`.
