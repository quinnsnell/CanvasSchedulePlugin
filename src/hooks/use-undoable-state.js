/**
 * Wraps useState with an undo/redo stack. Snapshots are deep-cloned on
 * each mutation (via structuredClone) so an entire complex state tree
 * can be rolled back without sharing references.
 *
 * Usage:
 *
 *   const { state, setState, updateState, undo, redo, canUndo, canRedo } =
 *     useUndoableState(initial);
 *
 *   updateState((s) => { s.foo = 'bar'; return s; });         // snapshots
 *   updateState((s) => { s.foo = 'bar'; return s; }, true);   // skips snapshot
 *
 * Pass `skipUndo: true` for bookkeeping changes (e.g., setting a
 * `loadedAt` timestamp) that the user wouldn't want to undo.
 */

import { useState, useCallback } from 'react';
import { UNDO_STACK_LIMIT } from '../config.js';

export default function useUndoableState(initial) {
  const [state, setStateRaw] = useState(initial);
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);

  const updateState = useCallback((fn, skipUndo) => {
    setStateRaw((s) => {
      if (!skipUndo) {
        setUndoStack((stack) => [...stack.slice(-(UNDO_STACK_LIMIT - 1)), structuredClone(s)]);
        setRedoStack([]);
      }
      return fn(structuredClone(s));
    });
  }, []);

  const undo = useCallback(() => {
    setUndoStack((stack) => {
      if (stack.length === 0) return stack;
      const prev = stack[stack.length - 1];
      setStateRaw((current) => {
        setRedoStack((r) => [...r.slice(-(UNDO_STACK_LIMIT - 1)), structuredClone(current)]);
        return prev;
      });
      return stack.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setRedoStack((stack) => {
      if (stack.length === 0) return stack;
      const next = stack[stack.length - 1];
      setStateRaw((current) => {
        setUndoStack((u) => [...u.slice(-(UNDO_STACK_LIMIT - 1)), structuredClone(current)]);
        return next;
      });
      return stack.slice(0, -1);
    });
  }, []);

  return {
    state,
    setState: setStateRaw,
    updateState,
    undo,
    redo,
    undoStack,
    redoStack,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
  };
}
