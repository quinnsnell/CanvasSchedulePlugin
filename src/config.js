/**
 * Tunable constants used across the app. Centralized so they're easy
 * to find when adjusting throttling, timing, or storage policy.
 *
 * Anything that's a "magic number" in business logic should live here
 * rather than buried inside a function. Pure values, no side effects.
 */

// ── Toast / banner timing ─────────────────────────────────────

/** Auto-dismiss delay for the bottom-of-screen status toast. */
export const TOAST_DISMISS_MS = 2400;

/** Auto-dismiss delay for the publish-success student-link banner. */
export const PUBLISH_BANNER_DISMISS_MS = 12000;

// ── Pending-creation TTL ──────────────────────────────────────

/**
 * How long a "+ Assignment" / "+ Quiz" placeholder stays valid before
 * being garbage-collected by syncFromCanvas. Long enough that the user
 * can wander off and come back; short enough that abandoned placeholders
 * don't claim subsequent creations.
 */
export const PENDING_TTL_MS = 60 * 60 * 1000; // 1 hour

// ── Canvas API rate limiting ──────────────────────────────────
//
// Canvas's per-token rate limit is shared across all requests from the
// same token. The default cap is roughly 700 requests / minute, but
// it varies by institution and is sometimes lower in development
// environments. Stay well under that even when other tabs are using
// the same token.

/** Date-push batch (after course-clone import). 5 parallel × 1.5s sleep ≈ 200 req/min. */
export const DATE_PUSH_BATCH_SIZE = 5;
export const DATE_PUSH_SLEEP_MS = 1500;

/** Per-item delete batch (manual course wipe fallback). Same envelope as date-push. */
export const WIPE_DELETE_BATCH_SIZE = 5;
export const WIPE_DELETE_SLEEP_MS = 1500;

// ── Course-clone progress polling ─────────────────────────────
//
// Adaptive: poll fast at the start (when the migration is most likely
// already done), back off as we wait. No hard timeout — Canvas can take
// a long time on large courses with many files.

/** Initial poll interval for the first window. */
export const CLONE_POLL_FAST_MS = 3000;

/** Slower poll interval after the first window. */
export const CLONE_POLL_SLOW_MS = 10000;

/** Even slower poll interval after the second window. */
export const CLONE_POLL_VERY_SLOW_MS = 30000;

/** Switch from FAST to SLOW after this many seconds of polling. */
export const CLONE_POLL_FAST_WINDOW_SEC = 120;

/** Switch from SLOW to VERY_SLOW after this many seconds. */
export const CLONE_POLL_SLOW_WINDOW_SEC = 600;

// ── Day picker cap ────────────────────────────────────────────

/** Max calendar days the +Day popover offers (after the row's date). */
export const ADDABLE_DAYS_MAX = 21;

// ── Undo stack ────────────────────────────────────────────────

/** How many state snapshots the undo stack keeps. */
export const UNDO_STACK_LIMIT = 30;
