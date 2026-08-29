/**
 * RichEditor — contentEditable-based rich text editor for note items.
 * Provides a toolbar (bold/italic/list/link/image), drag-paste image
 * handling, and pickers for inserting Canvas file or page links.
 *
 * Uses document.execCommand for formatting. The API is deprecated but
 * works in every major browser as of 2026; if it ever stops working,
 * swap to tiptap or lexical.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Bold, Italic, Link as LinkIcon, FileText, BookOpen, X, Image, Upload,
} from 'lucide-react';
import { T, FONT_BODY, FONT_MONO } from '../theme.js';
import { CanvasAPI } from '../canvas-api.js';
import { ToolbarBtn } from './ui.jsx';

export default function RichEditor({ initialHtml, canvas, onSave, onCancel }) {
  const ref = useRef(null);
  const [canvasPicker, setCanvasPicker] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const savedRangeRef = useRef(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.innerHTML = initialHtml || '<p></p>';
      ref.current.focus();
      // Place cursor at end so the user can keep typing.
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(ref.current);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }, []);

  const exec = (cmd, val = null) => {
    document.execCommand(cmd, false, val);
    ref.current?.focus();
  };

  const fileInputRef = useRef(null);
  const uploadInputRef = useRef(null);

  const insertImageFromFile = (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      document.execCommand('insertImage', false, reader.result);
      ref.current?.focus();
    };
    reader.readAsDataURL(file);
  };

  const handleImageButton = () => {
    fileInputRef.current?.click();
  };

  // Save the current selection so we can restore it after the file dialog
  // steals focus. execCommand('insertHTML') only works with an active range
  // inside the editor, so without this the link would land at document start.
  const rememberSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && ref.current?.contains(sel.anchorNode)) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
  };

  const restoreSelection = () => {
    ref.current?.focus();
    const range = savedRangeRef.current;
    if (!range) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };

  const handleUploadButton = () => {
    if (uploading) return;
    rememberSelection();
    uploadInputRef.current?.click();
  };

  const uploadFileToCanvas = async (file) => {
    if (!file || !canvasReady) return;
    setUploadError(null);
    setUploading(true);
    try {
      const meta = await CanvasAPI.uploadUserFile(canvas.baseUrl, canvas.token, canvas.courseId, file);
      const base = canvas.baseUrl.replace(/\/+$/, '');
      // Prefer the Canvas-hosted download URL (auth-gated, stable) over the
      // presigned url in `meta.url` — the latter expires.
      const fileId = meta && typeof meta === 'object' ? meta.id : null;
      const displayName = (meta && meta.display_name) || file.name;
      if (!fileId) throw new Error('Upload succeeded but Canvas returned no file id');
      const href = `${base}/courses/${canvas.courseId}/files/${fileId}/download`;
      restoreSelection();
      const escaped = displayName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      document.execCommand('insertHTML', false, `<a href="${href}">${escaped}</a>`);
    } catch (e) {
      setUploadError(e.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handlePaste = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        insertImageFromFile(item.getAsFile());
        return;
      }
    }
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
        <ToolbarBtn onClick={() => exec('bold')} title="Bold"><Bold size={12} /></ToolbarBtn>
        <ToolbarBtn onClick={() => exec('italic')} title="Italic"><Italic size={12} /></ToolbarBtn>
        <ToolbarBtn onClick={() => exec('insertUnorderedList')} title="Bullet list">•</ToolbarBtn>
        <ToolbarBtn onClick={insertLink} title="Insert link"><LinkIcon size={12} /></ToolbarBtn>
        <ToolbarBtn onClick={handleImageButton} title="Insert image"><Image size={12} /></ToolbarBtn>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) insertImageFromFile(file);
            e.target.value = '';
          }}
        />
        {canvasReady && (
          <>
            <ToolbarBtn onClick={() => openCanvasPicker('files')} title="Insert Canvas file link">
              <FileText size={12} />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => openCanvasPicker('pages')} title="Insert Canvas page link">
              <BookOpen size={12} />
            </ToolbarBtn>
            <ToolbarBtn
              onClick={handleUploadButton}
              title={uploading ? 'Uploading to Canvas…' : 'Upload file to Canvas and insert link'}
              disabled={uploading}
            >
              <Upload size={12} />
            </ToolbarBtn>
            <input
              ref={uploadInputRef}
              type="file"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadFileToCanvas(file);
                e.target.value = '';
              }}
            />
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

      {/* Upload status */}
      {(uploading || uploadError) && (
        <div style={{
          fontFamily: FONT_MONO, fontSize: '10px', marginBottom: 6,
          color: uploadError ? T.ox : T.muted,
        }}>
          {uploadError ? `Upload failed: ${uploadError}` : 'Uploading to Canvas…'}
        </div>
      )}

      {/* Canvas file/page picker dropdown */}
      {canvasPicker && (
        <CanvasPickerDropdown
          picker={canvasPicker}
          onPick={pickCanvasItem}
          onClose={() => setCanvasPicker(null)}
        />
      )}

      {/* Editable area */}
      <style>{`
        .planner-rich-editor img {
          max-width: 100%;
          border-radius: 4px;
          margin: 4px 0;
        }
      `}</style>
      <div
        ref={ref}
        className="planner-rich planner-rich-editor"
        contentEditable
        suppressContentEditableWarning
        onPaste={handlePaste}
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
