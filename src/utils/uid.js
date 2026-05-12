/**
 * Item ID generation. The pending-creation TTL lives in config.js;
 * re-exported here for backwards-compatible imports.
 */

/** Short random ID for an item card ("i_" + 8 chars from base36). */
export const uid = () => 'i_' + Math.random().toString(36).slice(2, 10);

export { PENDING_TTL_MS } from '../config.js';
