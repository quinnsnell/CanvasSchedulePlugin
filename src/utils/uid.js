/**
 * Item ID generation + the TTL for pending-creation records.
 */

/** Short random ID for an item card ("i_" + 8 chars from base36). */
export const uid = () => 'i_' + Math.random().toString(36).slice(2, 10);

/**
 * How long a pending-creation record (the placeholder pushed when the
 * user clicks "+ Assignment" / "+ Quiz") stays valid before expiring
 * unclaimed. Garbage-collected by syncFromCanvas.
 */
export const PENDING_TTL_MS = 60 * 60 * 1000; // 1 hour
