/**
 * ModuleSidebar — list of Canvas modules as draggable pills.
 *
 * Each pill carries an id like `module:<canvasId>` so handleDragEnd can
 * route it to a date-drop instead of treating it as a planner item.
 * Pills that are already placed somewhere on the schedule render in a
 * dim/checked state so the instructor sees what's still unplaced.
 */

import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { Check, Boxes, GripVertical } from 'lucide-react';
import { T, FONT_MONO } from '../theme.js';
import { moduleCanvasId } from '../utils.js';

export default function ModuleSidebar({ modules, placedModules, isStudent }) {
  if (!modules || modules.length === 0) return null;

  // Set of Canvas module ids already placed somewhere on the schedule.
  const placedIds = new Set(
    Object.values(placedModules || {})
      .map(moduleCanvasId)
      .filter(Boolean)
  );

  return (
    <div>
      <div style={{
        fontFamily: FONT_MONO, fontSize: '10px', letterSpacing: '0.2em',
        textTransform: 'uppercase', color: T.muted, marginBottom: 8,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <Boxes size={11} /> Canvas Modules
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {modules.map((m) => (
          <ModulePill
            key={m.id}
            module={m}
            placed={placedIds.has(m.id)}
            isStudent={isStudent}
          />
        ))}
      </div>
      {!isStudent && (
        <p style={{
          fontFamily: FONT_MONO, fontSize: '9px', color: T.muted,
          marginTop: 8, lineHeight: 1.4,
        }}>
          Drag a module onto a date to mark where it begins.
          Unplaced modules don't appear on the student schedule.
        </p>
      )}
    </div>
  );
}

function ModulePill({ module, placed, isStudent }) {
  // dnd-kit treats this draggable as a separate id-space. Prefix so
  // handleDragEnd can dispatch it differently from item drags.
  const dragId = `module:${module.id}`;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    data: { type: 'module', moduleId: module.id, moduleName: module.name },
    disabled: isStudent,
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...(isStudent ? {} : listeners)}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '4px 8px',
        background: placed ? T.subtle : T.paper,
        border: `1px solid ${T.border}`,
        borderLeft: `3px solid ${placed ? T.muted : T.inkBlue}`,
        borderRadius: 3,
        fontFamily: FONT_MONO, fontSize: '11px',
        color: placed ? T.muted : T.ink,
        cursor: isStudent ? 'default' : 'grab',
        opacity: isDragging ? 0.4 : 1,
        touchAction: 'none',
      }}
      title={placed ? 'Already placed on the schedule' : 'Drag onto a date'}
    >
      {!isStudent && <GripVertical size={11} style={{ color: T.faint, flexShrink: 0 }} />}
      <span style={{
        flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {module.name}
      </span>
      {placed && <Check size={12} style={{ color: T.forest, flexShrink: 0 }} />}
    </div>
  );
}
