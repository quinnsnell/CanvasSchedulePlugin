/**
 * Header — app toolbar with course title, metadata, search, and action buttons.
 */

import React, { useState, useRef } from 'react';
import {
  X, Eye, EyeOff, Settings, RefreshCw,
  Upload, History, Link2, Check,
  Undo2, Redo2, ChevronRight, Printer, CalendarDays, Sun, Moon, Search, Repeat,
} from 'lucide-react';
import { T, FONT_DISPLAY, FONT_MONO } from '../theme.js';
import { DAY_FULL, fmtFull } from '../utils.js';
import { IconButton, ToggleButton, inputStyle } from './ui.jsx';

export default function Header({
  state, isStudent, hashStudent, allDays, filteredDays,
  searchQuery, onSearchChange,
  filterGroup, onFilterGroupChange, assignmentGroups,
  darkMode, undoStack, redoStack,
  onToggleDark, onToggleStudent, onUndo, onRedo, onExportICal,
  onShowShiftModal, onShowRecurringModal, onPublish, publishing, onShareLink, lastPublishedUrl, onToggleSetup,
  onToggleActivityLog,
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef(null);
  const isFiltering = searchQuery.trim().length > 0 || filterGroup !== null;
  const groupList = Object.values(assignmentGroups || {});
  const hasGroups = groupList.length > 0;

  const toggleSearch = () => {
    if (searchOpen) {
      onSearchChange('');
      setSearchOpen(false);
    } else {
      setSearchOpen(true);
      setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  };

  return (
    <header role="banner" style={{ borderBottom: `1px solid ${T.border}`, background: T.paper }}>
      <div className="planner-header" style={{ maxWidth: 1152, margin: '0 auto' }}>
        <div className="planner-header-row">
          <div style={{ minWidth: 0, flex: 1 }}>
            <h1 className="planner-title" style={{ fontSize: '18px', margin: 0 }}>
              {state.setup.courseTitle || 'Course Schedule'}
            </h1>
            <div style={{ fontFamily: FONT_MONO, fontSize: '10px', letterSpacing: '0.18em', color: T.muted, textTransform: 'uppercase', marginTop: 4 }}>
              {isFiltering
                ? `Showing ${filteredDays.length} of ${allDays.length} days`
                : `${allDays.length} meetings`}
            </div>
            {state.setup.classDays?.length > 0 && (
              <div style={{ fontFamily: FONT_MONO, fontSize: '10px', letterSpacing: '0.12em', color: T.muted, marginTop: 2 }}>
                {state.setup.classDays.map((c) => DAY_FULL[c]).join(', ')}
              </div>
            )}
            {state.setup.startDate && state.setup.endDate && (
              <div style={{ fontFamily: FONT_MONO, fontSize: '10px', letterSpacing: '0.12em', color: T.muted, marginTop: 2 }}>
                {fmtFull(state.setup.startDate)} → {fmtFull(state.setup.endDate)}
              </div>
            )}
            {!isStudent && (
              <div style={{ fontFamily: FONT_MONO, fontSize: '10px', color: T.muted, marginTop: 4 }}>
                Build {new Date(__BUILD_TIME__).toLocaleString()}
                {state.lastSaved && <> · Saved {new Date(state.lastSaved).toLocaleString()}</>}
              </div>
            )}
          </div>

          {/* Search bar (collapsible) */}
          {searchOpen && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, maxWidth: 220 }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => onSearchChange(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') toggleSearch(); }}
                  placeholder="Filter schedule..."
                  aria-label="Search schedule"
                  style={{
                    ...inputStyle(),
                    width: '100%',
                    padding: '5px 28px 5px 8px',
                    fontSize: '12px',
                  }}
                />
                {searchQuery && (
                  <button
                    onClick={() => { onSearchChange(''); searchInputRef.current?.focus(); }}
                    aria-label="Clear search"
                    style={{
                      position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
                      background: 'transparent', border: 'none', cursor: 'pointer',
                      color: T.muted, padding: 2, display: 'flex', alignItems: 'center',
                    }}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>
          )}

          <nav aria-label="Schedule tools" className="flex items-center gap-2 flex-wrap">
            <IconButton onClick={toggleSearch} aria-label={searchOpen ? 'Close search' : 'Search schedule'}>
              <Search size={16} color={isFiltering ? T.inkBlue : T.ink} />
            </IconButton>
            {hasGroups && (
              <select
                value={filterGroup ?? ''}
                onChange={(e) => onFilterGroupChange(e.target.value ? Number(e.target.value) : null)}
                aria-label="Filter by assignment group"
                style={{
                  ...inputStyle(),
                  fontSize: '11px',
                  padding: '4px 6px',
                  maxWidth: 150,
                  fontFamily: FONT_MONO,
                  color: filterGroup !== null ? T.inkBlue : T.muted,
                }}
              >
                <option value="">All groups</option>
                {groupList.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            )}
            {!hashStudent && (
              <ToggleButton active={isStudent} onClick={onToggleStudent}
                aria-label={isStudent ? 'Switch to editor view' : 'Switch to student view'}>
                {isStudent ? <Eye size={14} /> : <EyeOff size={14} />}
                {isStudent ? 'Student' : 'Editor'}
              </ToggleButton>
            )}
            <IconButton onClick={onToggleDark} aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}>
              {darkMode ? <Sun size={16} /> : <Moon size={16} />}
            </IconButton>
            <IconButton onClick={onExportICal} aria-label="Download iCal calendar file">
              <CalendarDays size={16} />
            </IconButton>
            <IconButton onClick={() => window.print()} aria-label="Print schedule">
              <Printer size={16} />
            </IconButton>
            {!isStudent && (
              <>
                <IconButton onClick={onUndo} aria-label="Undo last action" disabled={undoStack.length === 0}>
                  <Undo2 size={16} color={undoStack.length === 0 ? T.faint : T.ink} />
                </IconButton>
                <IconButton onClick={onRedo} aria-label="Redo last action" disabled={redoStack.length === 0}>
                  <Redo2 size={16} color={redoStack.length === 0 ? T.faint : T.ink} />
                </IconButton>
                <IconButton onClick={onShowShiftModal} aria-label="Shift all dates forward or backward">
                  <ChevronRight size={16} />
                </IconButton>
                <IconButton onClick={onShowRecurringModal} aria-label="Create recurring note">
                  <Repeat size={16} />
                </IconButton>
                {state.canvas.connected && state.canvas.courseId && (<>
                  <IconButton onClick={onPublish} aria-label="Publish schedule to Canvas" disabled={publishing}>
                    {publishing ? <RefreshCw size={16} className="animate-spin" /> : <Upload size={16} />}
                  </IconButton>
                  <IconButton onClick={onShareLink} aria-label={lastPublishedUrl ? 'Copy shareable link' : 'Publish first to get a shareable link'}>
                    <Link2 size={16} color={lastPublishedUrl ? T.inkBlue : T.muted} />
                  </IconButton>
                </>)}
                <IconButton onClick={onToggleActivityLog} aria-label="Toggle publish history">
                  <History size={16} />
                </IconButton>
                <IconButton onClick={onToggleSetup} aria-label="Course setup">
                  <Settings size={16} color={state.canvas.connected ? T.forest : T.ink} />
                </IconButton>
              </>
            )}
          </nav>
        </div>
      </div>
    </header>
  );
}
