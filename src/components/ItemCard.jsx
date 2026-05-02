/**
 * ItemCard — renders a single assignment or rich-text note card.
 * Supports drag-and-drop, inline editing, reorder buttons, and duplication.
 *
 * RichEditor — contentEditable-based editor with bold/italic/list/link toolbar,
 * plus Canvas file/page pickers for inserting links.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  GripVertical, Pencil, Trash2, Copy, ExternalLink,
  Bold, Italic, Link as LinkIcon, FileText, BookOpen, X,
  ChevronUp, ChevronDown,
} from 'lucide-react';
import { T, FONT_DISPLAY, FONT_BODY, FONT_MONO } from '../theme.js';
import { fmtMonthDay } from '../utils.js';
import { CanvasAPI } from '../canvas-api.js';
import { pillStyle, iconBtnStyle, ToolbarBtn } from './ui.jsx';

// ── Item Card ──────────────────────────────────────────────────

export default function ItemCard({
  item, isStudent, canvas,
  onUpdate, onDelete, onDuplicate, onMoveUp, onMoveDown,
  draggingId, setDraggingId,
  autoEdit, onAutoEditConsumed,
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

  const handleDragStart = (e) => {
    if (isStudent) { e.preventDefault(); return; }
    e.dataTransfer.setData('text/plain', item.id);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingId(item.id);
  };

  const accent = isAssign ? T.inkBlue : T.sienna;
  const accentSoft = isAssign ? T.inkBlueSoft : T.siennaSoft;
  const isDragging = draggingId === item.id;

  return (
    <div
      draggable={!isStudent && !editing && !titleEditing}
      onDragStart={handleDragStart}
      onDragEnd={() => setDraggingId(null)}
      className={`planner-card ${isDragging ? 'item-dragging' : ''}`}
      style={{
        background: T.paper,
        border: `1px solid ${T.border}`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: 3,
        padding: '10px 12px',
        display: 'flex', gap: 8, alignItems: 'flex-start',
        cursor: !isStudent && !editing && !titleEditing ? 'grab' : 'default',
        transition: 'opacity 120ms',
        minWidth: 0,
      }}
    >
      {/* Reorder grip + arrow buttons */}
      {!isStudent && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, flexShrink: 0, paddingTop: 2 }}>
          {onMoveUp && (
            <button className="kb-move-btn" onClick={onMoveUp} aria-label="Move item up">
              <ChevronUp size={12} />
            </button>
          )}
          <div style={{ color: T.faint }} aria-hidden="true">
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

// ── Assignment card content ────────────────────────────────────

function AssignmentContent({ item, isStudent, titleEditing, setTitleEditing, onUpdate, accent, accentSoft }) {
  return (
    <>
      <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 4 }}>
        <span style={pillStyle(accent, accentSoft)}>Assignment</span>
        {item.canvasId ? (
          <span style={{ fontFamily: FONT_MONO, fontSize: '10px', color: T.muted }}>
            Canvas #{item.canvasId}
          </span>
        ) : item.isDemo ? (
          <span style={{ fontFamily: FONT_MONO, fontSize: '9px', color: T.muted, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
            demo
          </span>
        ) : null}
        {item.htmlUrl && (
          <a href={item.htmlUrl} target="_blank" rel="noreferrer" style={{ color: T.muted }}
            aria-label={`Open ${item.title || 'assignment'} in Canvas`}>
            <ExternalLink size={11} />
          </a>
        )}
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
      ) : (
        <div
          onDoubleClick={() => !isStudent && setTitleEditing(true)}
          style={{ fontFamily: FONT_DISPLAY, fontSize: '15px', fontWeight: 500, color: T.ink, lineHeight: 1.3, wordBreak: 'break-word' }}
          title={!isStudent ? 'Double-click to rename' : undefined}
        >
          {item.title}
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

// ── Rich Editor ────────────────────────────────────────────────

function RichEditor({ initialHtml, canvas, onSave, onCancel }) {
  const ref = useRef(null);
  const [canvasPicker, setCanvasPicker] = useState(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.innerHTML = initialHtml || '<p></p>';
      ref.current.focus();
      // Place cursor at end
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(ref.current);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }, []);

  // execCommand is deprecated but still works in all browsers (2026).
  // Replace with tiptap/lexical if it breaks.
  const exec = (cmd, val = null) => {
    document.execCommand(cmd, false, val);
    ref.current?.focus();
  };

  const insertLink = () => {
    const url = window.prompt('Link URL:');
    if (!url) return;
    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 0) {
      exec('createLink', url);
    } else {
      const text = window.prompt('Link text:', url);
      exec('insertHTML', `<a href="${url}">${text || url}</a>`);
    }
  };

  const canvasReady = canvas?.connected && canvas?.courseId;

  const openCanvasPicker = async (type) => {
    if (!canvasReady) return;
    try {
      const items = type === 'files'
        ? await CanvasAPI.listFiles(canvas.baseUrl, canvas.token, canvas.courseId)
        : await CanvasAPI.listPages(canvas.baseUrl, canvas.token, canvas.courseId);
      setCanvasPicker({ type, items });
    } catch { setCanvasPicker({ type, items: [], error: true }); }
  };

  const pickCanvasItem = (item) => {
    const base = canvas.baseUrl.replace(/\/+$/, '');
    const url = canvasPicker.type === 'files'
      ? `${base}/courses/${canvas.courseId}/files/${item.id}/download`
      : `${base}/courses/${canvas.courseId}/pages/${item.url}`;
    const name = canvasPicker.type === 'files' ? item.display_name : item.title;
    exec('insertHTML', `<a href="${url}">${name}</a>`);
    setCanvasPicker(null);
  };

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center gap-1 mb-2 flex-wrap">
        <ToolbarBtn onClick={() => exec('bold')}><Bold size={12} /></ToolbarBtn>
        <ToolbarBtn onClick={() => exec('italic')}><Italic size={12} /></ToolbarBtn>
        <ToolbarBtn onClick={() => exec('insertUnorderedList')}>•</ToolbarBtn>
        <ToolbarBtn onClick={insertLink}><LinkIcon size={12} /></ToolbarBtn>
        {canvasReady && (
          <>
            <ToolbarBtn onClick={() => openCanvasPicker('files')} title="Insert Canvas file link">
              <FileText size={12} />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => openCanvasPicker('pages')} title="Insert Canvas page link">
              <BookOpen size={12} />
            </ToolbarBtn>
          </>
        )}
        <div className="ml-auto flex gap-1">
          <button onClick={onCancel} style={{
            fontFamily: FONT_MONO, fontSize: '10px', padding: '4px 8px',
            color: T.muted, border: `1px solid ${T.border}`, borderRadius: 2, background: T.paper,
          }}>
            Cancel
          </button>
          <button onClick={() => onSave(ref.current?.innerHTML || '')} style={{
            fontFamily: FONT_MONO, fontSize: '10px', padding: '4px 8px',
            color: '#fff', border: 'none', borderRadius: 2, background: T.inkBlue,
          }}>
            Save
          </button>
        </div>
      </div>

      {/* Canvas file/page picker dropdown */}
      {canvasPicker && (
        <CanvasPickerDropdown
          picker={canvasPicker}
          onPick={pickCanvasItem}
          onClose={() => setCanvasPicker(null)}
        />
      )}

      {/* Editable area */}
      <div
        ref={ref}
        className="planner-rich"
        contentEditable
        suppressContentEditableWarning
        style={{
          fontFamily: FONT_BODY, fontSize: '14px', color: T.inkMid, lineHeight: 1.5,
          minHeight: 60, padding: 8, border: `1px solid ${T.borderStrong}`,
          borderRadius: 3, background: T.cream,
        }}
      />
    </div>
  );
}

// ── Canvas file/page picker ────────────────────────────────────

function CanvasPickerDropdown({ picker, onPick, onClose }) {
  return (
    <div style={{
      border: `1px solid ${T.border}`, borderRadius: 3, background: T.paper,
      maxHeight: 180, overflowY: 'auto', marginBottom: 6, fontSize: '12px',
    }}>
      <div className="flex items-center justify-between" style={{
        padding: '6px 8px', borderBottom: `1px solid ${T.border}`, background: T.subtle,
      }}>
        <span style={{ fontFamily: FONT_MONO, fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: T.muted }}>
          {picker.type === 'files' ? 'Course files' : 'Course pages'}
        </span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.muted, padding: 0 }}>
          <X size={12} />
        </button>
      </div>
      {picker.error ? (
        <div style={{ padding: 8, color: T.ox }}>Failed to load</div>
      ) : picker.items.length === 0 ? (
        <div style={{ padding: 8, color: T.muted }}>No {picker.type} found</div>
      ) : (
        picker.items.map((item) => (
          <button
            key={item.id || item.url}
            onClick={() => onPick(item)}
            style={{
              display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px',
              background: 'none', border: 'none', borderBottom: `1px solid ${T.subtle}`,
              cursor: 'pointer', fontSize: '12px', color: T.ink, fontFamily: FONT_BODY,
            }}
            onMouseEnter={(e) => { e.target.style.background = T.inkBlueSoft; }}
            onMouseLeave={(e) => { e.target.style.background = 'none'; }}
          >
            {picker.type === 'files' ? item.display_name : item.title}
          </button>
        ))
      )}
    </div>
  );
}
