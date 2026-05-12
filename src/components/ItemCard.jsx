/**
 * ItemCard — renders a single assignment or rich-text note card.
 * Supports drag-and-drop, inline editing, reorder buttons, and duplication.
 * Rich-note editing is delegated to ./RichEditor.jsx.
 */

import React, { useState, useEffect } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  GripVertical, Pencil, Trash2, Copy,
  ChevronUp, ChevronDown,
} from 'lucide-react';
import { T, FONT_DISPLAY, FONT_BODY, FONT_MONO } from '../theme.js';
import { fmtMonthDay } from '../utils.js';
import { pillStyle, iconBtnStyle } from './ui.jsx';
import RichEditor from './RichEditor.jsx';

// ── Item Card ──────────────────────────────────────────────────

export default function ItemCard({
  item, isStudent, canvas,
  onUpdate, onDelete, onDuplicate, onMoveUp, onMoveDown,
  draggingId,
  autoEdit, onAutoEditConsumed,
  assignmentGroups,
}) {
  const isAssign = item.type === 'assign';
  const isRich = item.type === 'rich';
  const [editing, setEditing] = useState(false);
  const [titleEditing, setTitleEditing] = useState(false);

  // Auto-open editor when a new note is created
  useEffect(() => {
    if (autoEdit && isRich && !isStudent) {
      setEditing(true);
      onAutoEditConsumed?.();
    }
  }, [autoEdit, isRich, isStudent, onAutoEditConsumed]);

  const canDrag = !isStudent && !editing && !titleEditing;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({
    id: item.id,
    disabled: !canDrag,
  });

  const isQuiz = isAssign && item.isQuiz;
  const accent = isQuiz ? T.amber : isAssign ? T.inkBlue : T.sienna;
  const accentSoft = isQuiz ? T.amberSoft : isAssign ? T.inkBlueSoft : T.siennaSoft;
  const isDragging = isSortableDragging || draggingId === item.id;

  const style = {
    background: T.paper,
    border: `1px solid ${T.border}`,
    borderLeft: `3px solid ${accent}`,
    borderRadius: 3,
    padding: '10px 12px',
    display: 'flex', gap: 8, alignItems: 'flex-start',
    cursor: canDrag ? 'grab' : 'default',
    transition: transition || 'opacity 120ms',
    minWidth: 0,
    transform: CSS.Transform.toString(transform),
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      className="planner-card"
      style={style}
      {...attributes}
    >
      {/* Reorder grip + arrow buttons */}
      {!isStudent && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, flexShrink: 0, paddingTop: 2 }}>
          {onMoveUp && (
            <button className="kb-move-btn" onClick={onMoveUp} aria-label="Move item up">
              <ChevronUp size={12} />
            </button>
          )}
          <div style={{ color: T.faint, cursor: canDrag ? 'grab' : 'default', touchAction: 'none' }}
               aria-hidden="true" {...(canDrag ? listeners : {})}>
            <GripVertical size={14} />
          </div>
          {onMoveDown && (
            <button className="kb-move-btn" onClick={onMoveDown} aria-label="Move item down">
              <ChevronDown size={12} />
            </button>
          )}
        </div>
      )}

      {/* Card content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {isAssign && (
          <AssignmentContent
            item={item} isStudent={isStudent}
            titleEditing={titleEditing} setTitleEditing={setTitleEditing}
            onUpdate={onUpdate} accent={accent} accentSoft={accentSoft}
            assignmentGroups={assignmentGroups}
          />
        )}
        {isRich && (
          <RichContent
            item={item} isStudent={isStudent} canvas={canvas}
            editing={editing} setEditing={setEditing}
            onUpdate={onUpdate}
          />
        )}
      </div>

      {/* Action buttons (edit, duplicate, delete) */}
      {!isStudent && !editing && !titleEditing && (
        <div className="flex flex-col gap-1" style={{ opacity: 0.6, flexShrink: 0 }}>
          {isRich && (
            <button onClick={() => setEditing(true)} aria-label="Edit note" style={iconBtnStyle()}>
              <Pencil size={13} />
            </button>
          )}
          {isAssign && (
            <button onClick={() => setTitleEditing(true)} aria-label={`Rename ${item.title || 'assignment'}`} style={iconBtnStyle()}>
              <Pencil size={13} />
            </button>
          )}
          {onDuplicate && (
            <button onClick={onDuplicate} aria-label="Duplicate item" style={iconBtnStyle()}>
              <Copy size={13} />
            </button>
          )}
          <button onClick={() => onDelete(item.id)} aria-label={`Delete ${item.title || 'item'}`} style={iconBtnStyle()}>
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * DragOverlayCard — static (non-sortable) version of ItemCard used in the DragOverlay.
 * Renders the same visual but without dnd-kit hooks.
 */
export function DragOverlayCard({ item }) {
  if (!item) return null;
  const isAssign = item.type === 'assign';
  const isQuiz = isAssign && item.isQuiz;
  const accent = isQuiz ? T.amber : isAssign ? T.inkBlue : T.sienna;
  const accentSoft = isQuiz ? T.amberSoft : isAssign ? T.inkBlueSoft : T.siennaSoft;

  return (
    <div
      className="planner-card"
      style={{
        background: T.paper,
        border: `1px solid ${T.border}`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: 3,
        padding: '10px 12px',
        display: 'flex', gap: 8, alignItems: 'flex-start',
        cursor: 'grabbing',
        minWidth: 0,
        boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
        opacity: 0.95,
        width: 320,
      }}
    >
      <div style={{ color: T.faint, flexShrink: 0, paddingTop: 2 }} aria-hidden="true">
        <GripVertical size={14} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {isAssign ? (
          <>
            <div style={{ marginBottom: 4 }}>
              <span style={pillStyle(accent, accentSoft)}>{isQuiz ? 'Quiz' : 'Assignment'}</span>
            </div>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: '15px', fontWeight: 500, color: T.ink, lineHeight: 1.3 }}>
              {item.title || 'Untitled'}
            </div>
          </>
        ) : (
          <div
            className="planner-rich"
            style={{ fontFamily: FONT_BODY, fontSize: '14px', color: T.inkMid, lineHeight: 1.5, maxHeight: 60, overflow: 'hidden' }}
            dangerouslySetInnerHTML={{ __html: item.html || '<em>Note</em>' }}
          />
        )}
      </div>
    </div>
  );
}

// ── Assignment card content ────────────────────────────────────

function AssignmentContent({ item, isStudent, titleEditing, setTitleEditing, onUpdate, accent, accentSoft, assignmentGroups }) {
  const group = item.groupId && assignmentGroups ? assignmentGroups[item.groupId] : null;
  // Hide the group badge when the course has only one assignment group —
  // that's Canvas's default "Assignments" bucket and the badge would just
  // repeat the type pill. Only worth showing when the course actually
  // subdivides assignments (Homework / Exams / Projects / etc.).
  const groupCount = Object.keys(assignmentGroups || {}).length;
  const showGroup = group && groupCount > 1;
  return (
    <>
      <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 4 }}>
        <span style={pillStyle(accent, accentSoft)}>{item.isQuiz ? 'Quiz' : 'Assignment'}</span>
        {showGroup && (
          <span style={{
            fontFamily: FONT_MONO, fontSize: '9px', fontWeight: 500,
            padding: '1px 6px', borderRadius: 8,
            color: group.color, background: `${group.color}18`,
            border: `1px solid ${group.color}44`,
            letterSpacing: '0.04em', whiteSpace: 'nowrap',
          }}>
            {group.name}
          </span>
        )}
        {item.canvasId ? (
          <span style={{ fontFamily: FONT_MONO, fontSize: '10px', color: T.muted }}>
            Canvas #{item.canvasId}
          </span>
        ) : item.isDemo ? (
          <span style={{ fontFamily: FONT_MONO, fontSize: '9px', color: T.muted, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
            demo
          </span>
        ) : null}
      </div>

      {titleEditing && !isStudent ? (
        <input
          defaultValue={item.title} autoFocus
          onBlur={(e) => { onUpdate(item.id, { title: e.target.value || 'Untitled' }); setTitleEditing(false); }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
          style={{
            fontFamily: FONT_DISPLAY, fontSize: '15px', fontWeight: 500, width: '100%',
            border: `1px solid ${T.borderStrong}`, padding: '2px 4px', borderRadius: 2,
            background: T.cream, color: T.ink,
          }}
        />
      ) : item.htmlUrl ? (
        <a
          href={item.htmlUrl}
          target="_blank"
          rel="noreferrer"
          className="planner-title-link"
          style={{
            fontFamily: FONT_DISPLAY, fontSize: '15px', fontWeight: 500, color: T.ink,
            lineHeight: 1.3, wordBreak: 'break-word',
            textDecoration: 'none', display: 'inline-block',
          }}
          aria-label={`Open ${item.title || (item.isQuiz ? 'quiz' : 'assignment')} in Canvas`}
        >
          {item.title || 'Untitled'}
        </a>
      ) : (
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: '15px', fontWeight: 500, color: T.ink, lineHeight: 1.3, wordBreak: 'break-word' }}>
          {item.title || 'Untitled'}
        </div>
      )}

      <div style={{ marginTop: 4, fontFamily: FONT_MONO, fontSize: '11px', color: T.muted }}>
        {item.points ? `${item.points} pts` : 'no points'}
        {item.dueDate && <> · due {fmtMonthDay(item.dueDate)}</>}
      </div>
    </>
  );
}

// ── Rich-text card content ─────────────────────────────────────

function RichContent({ item, isStudent, canvas, editing, setEditing, onUpdate }) {
  return editing && !isStudent ? (
    <RichEditor
      initialHtml={item.html}
      canvas={canvas}
      onSave={(html) => { onUpdate(item.id, { html }); setEditing(false); }}
      onCancel={() => setEditing(false)}
    />
  ) : (
    <div
      className="planner-rich"
      onDoubleClick={() => !isStudent && setEditing(true)}
      style={{
        fontFamily: FONT_BODY, fontSize: '14px', color: T.inkMid, lineHeight: 1.5,
        cursor: !isStudent ? 'text' : 'default', wordBreak: 'break-word',
      }}
      dangerouslySetInnerHTML={{
        __html: item.html || `<p style="color:${T.muted};font-style:italic">Empty note — click pencil to edit</p>`,
      }}
    />
  );
}

