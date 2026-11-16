# 0001. Scheduled publishing pins revisions and fails closed

Status: accepted · 2026-11-16 · issue #9

## Context

Publishing renders, builds, commits and pushes the staged batch. Issue #9 asks for a publish time per batch that survives restarts. PR #31 binds staging to an approved content hash and serializes checkout writers with a lock. It does not recover an interrupted publish or stop an orphaned build process.

## Decision

- A schedule row in SQLite (`publish_schedules`) stores the due time in UTC, the writer's IANA time zone for display, and the exact `{path, hash}` of every staged revision. A partial unique index allows one pending or running schedule.
- A server timer ticks every minute and once at startup. It takes the checkout write lock, then claims a due schedule and publishes through `publishLocked`, the same code path as the manual button. Claim, publish and result all happen inside one lock, so a `running` row seen under the lock belongs to a dead process.
- The run publishes only if the staged batch equals the pins exactly. Any newer edit, restage, unstage or extra staged post fails the run before anything is written. Newer edits stay as drafts.
- These cases mark the schedule failed with a visible reason and never retry automatically: interrupted by a restart, missed by more than 30 minutes while the CMS was offline, an earlier publish push still pending, build failure, push failure (commit kept; "Retry publish push" resends it).
- A successful run records the commit and that it was pushed. Whether the site went live is not tracked (#5).
- Publishing manually while a schedule is pending cancels the schedule first.

## Consequences

- Unattended publishing requires PR #31; this branch is built on it.
- An interrupted run needs a person to check and reschedule. That is deliberate: the build subprocess may still be running and the commit state is unknown.
- One batch at a time. Staging more posts after scheduling blocks the run until the writer reschedules.
- Times are entered in the browser's time zone. Other zones are shown, not chosen.
