/**
 * Per-course localStorage persistence.
 *
 * Course planner data is keyed by courseId so multiple courses don't
 * collide. Meta (canvas credentials, last courseId) is shared across
 * courses under a single key.
 *
 * Falls back to `window.storage` when running inside a claude.ai
 * artifact (which doesn't expose localStorage); plain localStorage
 * otherwise.
 */

const KEY_PREFIX = 'class-planner-v3';
const KEY_META = 'class-planner-meta';

export const Store = {
  _key(courseId) { return courseId ? `${KEY_PREFIX}-${courseId}` : KEY_PREFIX; },

  async loadMeta() {
    try {
      const v = localStorage.getItem(KEY_META);
      return v ? JSON.parse(v) : null;
    } catch { return null; }
  },

  saveMeta(meta) {
    try { localStorage.setItem(KEY_META, JSON.stringify(meta)); } catch {}
  },

  async load(courseId) {
    try {
      if (typeof window !== 'undefined' && window.storage) {
        const r = await window.storage.get(this._key(courseId));
        return r?.value ? JSON.parse(r.value) : null;
      }
      if (typeof localStorage !== 'undefined') {
        const v = localStorage.getItem(this._key(courseId));
        return v ? JSON.parse(v) : null;
      }
      return null;
    } catch { return null; }
  },

  async save(data) {
    const courseId = data?.canvas?.courseId;
    try {
      if (typeof window !== 'undefined' && window.storage) {
        await window.storage.set(this._key(courseId), JSON.stringify(data));
        return true;
      }
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this._key(courseId), JSON.stringify(data));
        return true;
      }
      return false;
    } catch { return false; }
  },
};
