/**
 * Lightweight debug-logging helpers. Use these instead of bare console.log
 * for verbose diagnostics that are useful during development but noisy in
 * production builds.
 *
 * Vite tree-shakes the dead branch since `import.meta.env.DEV` is a static
 * constant at build time — production bundles won't contain the log calls
 * at all.
 *
 * `console.error` is intentionally NOT wrapped. Errors should always be
 * visible regardless of build mode.
 */

export const DEBUG = import.meta.env.DEV;

export function debugLog(...args) {
  if (DEBUG) console.log(...args);
}

export function debugWarn(...args) {
  if (DEBUG) console.warn(...args);
}
