/**
 * Auto-dismissing toast state.
 *
 * Returns `[toast, showToast]` where:
 *   - `toast` is `null` or `{ msg, kind }`. `kind` is 'ok' (default) or
 *     'err'. The renderer is responsible for the visuals.
 *   - `showToast(msg, kind?)` sets the toast and schedules a dismiss
 *     after TOAST_DISMISS_MS.
 *
 * Calling showToast while a toast is visible replaces it and resets the
 * timer — the most recent message wins.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { TOAST_DISMISS_MS } from '../config.js';

export default function useToast() {
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);

  const showToast = useCallback((msg, kind = 'ok') => {
    setToast({ msg, kind });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setToast(null), TOAST_DISMISS_MS);
  }, []);

  // Clear pending dismiss on unmount.
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return [toast, showToast];
}
