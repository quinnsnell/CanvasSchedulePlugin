/**
 * Module-marker helpers.
 *
 * `state.modules[date]` can be either:
 *   - A plain string  → manual entry from the `+Module` toolbar button
 *   - `{ title, canvasModuleId }` → placed from the Canvas modules sidebar
 *
 * The dual shape lets a single map carry both kinds without a destructive
 * migration; readers go through `moduleTitle()` to normalize.
 */

/** Resolve the display title from either shape. */
export function moduleTitle(v) {
  if (!v) return null;
  if (typeof v === 'string') return v;
  return v.title || null;
}

/** Canvas module id (or null for manual entries). */
export function moduleCanvasId(v) {
  if (!v || typeof v === 'string') return null;
  return v.canvasModuleId || null;
}
