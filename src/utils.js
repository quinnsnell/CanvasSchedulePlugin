/**
 * Re-exports for the split utility modules under src/utils/.
 *
 * Existing call sites can keep importing from `./utils.js`. New code
 * should prefer the focused sub-module imports (./utils/dates.js,
 * ./utils/template.js, etc.) so the dependency surface stays explicit.
 */

export {
  DAY_CODES, DAY_FULL, DAY_SHORT,
  addDays, generateClassDays, computeAllDays, getAddableDatesAfter,
  weekKey, weekNumber, localDateStr, fmtMonthDay, fmtFull,
} from './utils/dates.js';

export { uid, PENDING_TTL_MS } from './utils/uid.js';

export { generateICal, parseICal } from './utils/ical.js';

export { parseCSV } from './utils/csv.js';

export { rewriteEmbeddedLinks } from './utils/link-rewrite.js';

export { exportTemplate, importTemplate } from './utils/template.js';

export { Store } from './utils/store.js';
