/**
 * UnpublishedBadge — fixed-position indicator that the local schedule
 * has been edited since the last successful publish to Canvas.
 *
 * Click to publish. Hidden in student view, when Canvas isn't connected,
 * or when there's nothing to publish (clean state).
 */

import React from 'react';
import { Upload, RefreshCw } from 'lucide-react';
import { T, FONT_MONO } from '../theme.js';

export default function UnpublishedBadge({ publishing, onPublish }) {
  return (
    <button
      type="button"
      onClick={publishing ? undefined : onPublish}
      aria-label="Unpublished changes — click to publish to Canvas"
      title="Unpublished changes — click to publish to Canvas"
      className="no-print"
      style={{
        position: 'fixed',
        bottom: 24, right: 24,
        background: T.amber || '#d97706',
        color: '#fff',
        border: 'none', borderRadius: 4,
        padding: '8px 14px',
        fontFamily: FONT_MONO, fontSize: 11, fontWeight: 600,
        letterSpacing: '0.04em',
        boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
        cursor: publishing ? 'wait' : 'pointer',
        display: 'flex', alignItems: 'center', gap: 6,
        zIndex: 55,
        opacity: publishing ? 0.7 : 1,
      }}
    >
      <span style={{
        display: 'inline-block',
        width: 8, height: 8, borderRadius: '50%',
        background: '#fff',
        animation: publishing ? 'none' : 'unpublished-pulse 1.8s ease-in-out infinite',
      }} />
      {publishing
        ? <><RefreshCw size={12} className="animate-spin" /> Publishing…</>
        : <><Upload size={12} /> Unpublished changes</>}
      <style>{`
        @keyframes unpublished-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>
    </button>
  );
}
