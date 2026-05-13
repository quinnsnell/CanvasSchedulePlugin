/**
 * Top configuration panel: course title + semester dates + class meeting
 * days + Canvas connection + course-clone + import/template tools.
 *
 * The clone subpanel is the largest section — it owns its own progress
 * + cloneOverwrite state and renders CloneWarnings inline on completion.
 */

import React, { useState, useRef } from 'react';
import {
  X, RefreshCw, Check, AlertCircle, Cloud, Upload, Download, Copy,
} from 'lucide-react';
import { T, FONT_DISPLAY, FONT_BODY, FONT_MONO } from '../../theme.js';
import { DAY_CODES, DAY_SHORT, parseICal, parseCSV } from '../../utils.js';
import { CORS_PROXY, CORS_PROXY_DEFAULT, getCorsProxy, setCorsProxy } from '../../canvas-api.js';
import { Field, IconButton, ActionButton, inputStyle } from '../ui.jsx';
import CloneWarnings from './CloneWarnings.jsx';

export default function SetupPanel({ state, updateState, onImport, onExportTemplate, onImportTemplate, onConnect, onRefresh, refreshing, onSwitchCourse, onCloneCourse, onClose }) {
  const [title, setTitle] = useState(state.setup.courseTitle);
  const [start, setStart] = useState(state.setup.startDate);
  const [end, setEnd] = useState(state.setup.endDate);
  const [days, setDays] = useState(state.setup.classDays);

  // Canvas connection state
  const [baseUrl, setBaseUrl] = useState(state.canvas.baseUrl || '');
  const [token, setToken] = useState(state.canvas.token || '');
  const [proxyUrl, setProxyUrl] = useState(CORS_PROXY || '');
  const [busy, setBusy] = useState(false);
  const [canvasStatus, setCanvasStatus] = useState(null);

  // Clone-course state
  const [cloneSource, setCloneSource] = useState('');
  const [cloneOverwrite, setCloneOverwrite] = useState(false);
  const [cloneStatus, setCloneStatus] = useState(null);
  // { running, state: 'queued'|'running'|'completed'|'failed'|'stopped'|'resetting', completion, elapsedSec, error? }
  const cloneStopRef = useRef(false);

  const toggleDay = (c) =>
    setDays((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  const apply = () => {
    updateState((s) => {
      s.setup = { courseTitle: title, startDate: start, endDate: end, classDays: days };
      return s;
    });
    onClose();
  };

  const handleFileImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result;
      const ext = file.name.split('.').pop().toLowerCase();
      let events;
      if (ext === 'ics') {
        events = parseICal(text);
      } else if (ext === 'csv') {
        events = parseCSV(text);
      } else {
        events = [];
      }
      if (onImport) onImport(events);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleProxyChange = (val) => {
    setProxyUrl(val);
    const trimmed = val.trim().replace(/\/+$/, '');
    try { localStorage.setItem('planner-cors-proxy', trimmed); } catch {}
    setCorsProxy(trimmed || getCorsProxy());
  };

  const doClone = async () => {
    if (!cloneSource || !onCloneCourse) return;
    const targetName = state.canvas.courses.find((c) => String(c.id) === String(state.canvas.courseId))?.name || 'this course';
    const sourceName = state.canvas.courses.find((c) => String(c.id) === String(cloneSource))?.name || 'the source course';
    const confirmMsg = cloneOverwrite
      ? `⚠️ DESTRUCTIVE OVERWRITE\n\n` +
        `Step 1: DELETE all existing content from:\n  ${targetName}\n\n` +
        `Step 2: Copy content from:\n  ${sourceName}\n\n` +
        `Step 1 is irreversible. Canvas's Course Reset wipes assignments, quizzes, files, ` +
        `pages, modules, discussions, and announcements. The course shell stays (id, name, dates).\n\n` +
        `Type-and-confirm not implemented — click OK only if you are sure.`
      : `Copy all content (assignments, quizzes, files, modules, pages) from\n\n` +
        `  ${sourceName}\n\ninto\n\n  ${targetName}?\n\n` +
        `Canvas runs the copy server-side. Existing content in the target is preserved (additive).`;
    if (!window.confirm(confirmMsg)) return;
    cloneStopRef.current = false;
    setCloneStatus({ running: true, state: 'queued', completion: 0, elapsedSec: 0 });
    const result = await onCloneCourse(
      cloneSource,
      (p) => setCloneStatus({ running: true, ...p }),
      () => cloneStopRef.current,
      cloneOverwrite,
    );
    if (result.ok) {
      setCloneStatus({
        running: false, state: 'completed', completion: 100,
        schedule: result.schedule,
      });
    } else if (result.stopped) {
      setCloneStatus({ running: false, state: 'stopped' });
    } else {
      setCloneStatus({ running: false, state: 'failed', error: result.error });
    }
  };

  const stopClonePolling = () => { cloneStopRef.current = true; };

  const fmtElapsed = (sec) => {
    if (!sec) return '0s';
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s ? `${m}m ${s}s` : `${m}m`;
  };

  const doConnect = async () => {
    setBusy(true);
    setCanvasStatus(null);
    const result = await onConnect(baseUrl.trim(), token.trim());
    if (result.ok) {
      setCanvasStatus({ msg: `Connected — ${result.count} courses found`, kind: 'ok' });
    } else {
      setCanvasStatus({ msg: result.error, kind: 'err' });
    }
    setBusy(false);
  };

  return (
    <div style={{ background: T.paper, borderBottom: `1px solid ${T.border}` }}>
      <div className="planner-header" style={{ maxWidth: 1152, margin: '0 auto' }}>
        <div className="flex items-center justify-between mb-4">
          <h2 id="setup-heading" style={{ fontFamily: FONT_DISPLAY, fontSize: '18px', fontWeight: 600 }}>Course setup</h2>
          <IconButton onClick={onClose} aria-label="Close setup panel"><X size={16} /></IconButton>
        </div>

        {/* ── Semester settings ── */}
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <Field label="Course title">
            <input value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle()} />
          </Field>
          <Field label="Semester start">
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} style={inputStyle()} />
          </Field>
          <Field label="Semester end">
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} style={inputStyle()} />
          </Field>
        </div>
        <div className="mt-4">
          <Field label="Class meeting days">
            <div className="flex gap-2 flex-wrap">
              {DAY_CODES.map((c) => (
                <button key={c} onClick={() => toggleDay(c)}
                  style={{
                    padding: '6px 12px', borderRadius: 2,
                    fontFamily: FONT_MONO, fontSize: '11px', letterSpacing: '0.1em',
                    border: `1px solid ${days.includes(c) ? T.inkBlue : T.border}`,
                    background: days.includes(c) ? T.inkBlue : T.paper,
                    color: days.includes(c) ? '#fff' : T.muted,
                  }}>
                  {DAY_SHORT[c]}
                </button>
              ))}
            </div>
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <ActionButton onClick={apply} primary>Apply</ActionButton>
        </div>

        {/* ── Canvas connection ── */}
        <div style={{ marginTop: 24, paddingTop: 20, borderTop: `1px solid ${T.border}` }}>
          <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: '16px', fontWeight: 600, marginBottom: 8 }}>
            <Cloud size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: '-2px' }} />
            Canvas connection
          </h3>
          <p style={{ color: T.muted, fontSize: '13px', marginBottom: 16, maxWidth: 760 }}>
            Generate a Personal Access Token in Canvas (Account → Settings → "+ New Access Token").
            Refresh imports every Canvas assignment as a draggable card on its due date.
          </p>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <Field label="Canvas base URL">
              <input placeholder="https://youruniversity.instructure.com"
                value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} style={inputStyle()} />
            </Field>
            <Field label="Personal Access Token">
              <input type="password" placeholder="paste token…"
                value={token} onChange={(e) => setToken(e.target.value)} style={inputStyle()} />
            </Field>
            <Field label="CORS proxy URL (optional)">
              <input placeholder={CORS_PROXY_DEFAULT}
                value={proxyUrl} onChange={(e) => handleProxyChange(e.target.value)} style={inputStyle()} />
            </Field>
          </div>
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <ActionButton onClick={doConnect} primary>
              {busy ? <RefreshCw size={14} className="animate-spin" /> : <Cloud size={14} />}
              {state.canvas.connected ? 'Reconnect' : 'Connect'}
            </ActionButton>
            {state.canvas.connected && (
              <>
                <span style={{ color: T.forest, fontSize: '12px', fontFamily: FONT_MONO }}>
                  <Check size={12} style={{ display: 'inline', marginRight: 4 }} />
                  Connected
                </span>
                <select
                  value={state.canvas.courseId || ''}
                  onChange={(e) => onSwitchCourse(e.target.value)}
                  style={{ ...inputStyle(), width: 'auto', minWidth: 220 }}>
                  <option value="">— pick a course —</option>
                  {state.canvas.courses.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <ActionButton onClick={onRefresh} disabled={refreshing}>
                  <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> {refreshing ? 'Refreshing…' : 'Refresh'}
                </ActionButton>
              </>
            )}
          </div>
          {canvasStatus && (
            <div style={{
              marginTop: 14, padding: 10, borderRadius: 3, fontSize: '12px', display: 'flex', gap: 8,
              background: canvasStatus.kind === 'ok' ? T.successBg : T.errorBg,
              border: `1px solid ${canvasStatus.kind === 'ok' ? T.successBorder : T.errorBorder}`,
              color: canvasStatus.kind === 'ok' ? T.forest : T.ox,
            }}>
              {canvasStatus.kind === 'ok'
                ? <Check size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                : <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} />}
              <span>{canvasStatus.msg}</span>
            </div>
          )}
          {!state.canvas.connected && !canvasStatus && (
            <div style={{
              marginTop: 14, padding: 10, background: T.subtle, border: `1px solid ${T.border}`,
              borderRadius: 3, fontSize: '12px', color: T.muted, display: 'flex', gap: 8,
            }}>
              <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                If connecting fails, your browser may be blocking cross-origin requests (CORS).
                The app routes requests through a CORS proxy. You can use the default or enter your own proxy URL above.
              </span>
            </div>
          )}

          {/* ── Clone from another course (Canvas course copy) ── */}
          {state.canvas.connected && state.canvas.courseId && onCloneCourse && (() => {
            const targetCourse = state.canvas.courses.find((c) => String(c.id) === String(state.canvas.courseId));
            const targetName = targetCourse?.name || 'current course';
            return (
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px dashed ${T.border}` }}>
              <h4 style={{ fontFamily: FONT_DISPLAY, fontSize: '14px', fontWeight: 600, marginBottom: 4 }}>
                <Copy size={13} style={{ display: 'inline', marginRight: 6, verticalAlign: '-2px' }} />
                Copy content from another course
              </h4>
              <p style={{ color: T.muted, fontSize: '12px', marginBottom: 12, maxWidth: 760 }}>
                Two-step copy: (1) Canvas's native course copy duplicates assignments, quizzes, files, modules, pages, and discussions on the server side;
                (2) the source course's planner schedule (notes, modules, holidays, item placement) is pulled and re-mapped onto this semester's dates,
                with assignment cards re-linked to the new Canvas IDs by title. Existing content is preserved (additive).
              </p>
              <div style={{
                fontFamily: FONT_MONO, fontSize: '11px', color: T.muted, marginBottom: 8,
              }}>
                Copy into: <span style={{ color: T.ink, fontWeight: 600 }}>{targetName}</span>
                {' '}<span style={{ color: T.muted }}>(switch the course picker above to change)</span>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <select
                  value={cloneSource}
                  onChange={(e) => setCloneSource(e.target.value)}
                  disabled={cloneStatus?.running}
                  style={{ ...inputStyle(), width: 'auto', minWidth: 240 }}>
                  <option value="">— copy from… —</option>
                  {state.canvas.courses
                    .filter((c) => String(c.id) !== String(state.canvas.courseId))
                    .map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                </select>
                <ActionButton
                  onClick={doClone}
                  disabled={!cloneSource || cloneStatus?.running}
                  primary>
                  {cloneStatus?.running
                    ? <RefreshCw size={14} className="animate-spin" />
                    : <Copy size={14} />}
                  {cloneStatus?.running ? 'Copying…' : (cloneOverwrite ? 'Wipe + copy content' : 'Copy content')}
                </ActionButton>
                {cloneStatus?.running && (
                  <ActionButton onClick={stopClonePolling}>Stop checking</ActionButton>
                )}
              </div>
              <label
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                  marginTop: 10, cursor: cloneStatus?.running ? 'default' : 'pointer',
                  opacity: cloneStatus?.running ? 0.5 : 1,
                  padding: 8, borderRadius: 3,
                  background: cloneOverwrite ? T.errorBg : 'transparent',
                  border: `1px solid ${cloneOverwrite ? T.errorBorder : T.border}`,
                }}>
                <input
                  type="checkbox"
                  checked={cloneOverwrite}
                  disabled={cloneStatus?.running}
                  onChange={(e) => setCloneOverwrite(e.target.checked)}
                  style={{ accentColor: T.ox, width: 14, height: 14, marginTop: 2 }}
                />
                <span style={{ fontSize: '12px', color: T.ink, lineHeight: 1.5 }}>
                  <strong>Overwrite all existing content in target first</strong>
                  <span style={{ display: 'block', color: T.muted, marginTop: 2 }}>
                    Calls Canvas's Course Reset, then copies. Wipes every assignment, quiz, file,
                    page, module, and discussion in <strong>{targetName}</strong>. Course settings
                    (name, dates, enrollments) are preserved. Requires Course Reset permission on
                    your Canvas token. Irreversible.
                  </span>
                </span>
              </label>
              {cloneStatus && (
                <div style={{
                  marginTop: 12, padding: 10, borderRadius: 3, fontSize: '12px',
                  background: cloneStatus.state === 'failed' ? T.errorBg
                    : cloneStatus.state === 'completed' ? T.successBg
                    : T.subtle,
                  border: `1px solid ${
                    cloneStatus.state === 'failed' ? T.errorBorder
                    : cloneStatus.state === 'completed' ? T.successBorder
                    : T.border}`,
                  color: cloneStatus.state === 'failed' ? T.ox
                    : cloneStatus.state === 'completed' ? T.forest
                    : T.ink,
                }}>
                  {cloneStatus.state === 'failed' && (
                    <span><AlertCircle size={12} style={{ display: 'inline', marginRight: 6, verticalAlign: '-2px' }} />
                      Copy failed: {cloneStatus.error}</span>
                  )}
                  {cloneStatus.state === 'completed' && (() => {
                    const sch = cloneStatus.schedule || {};
                    const canvasLine = sch.canvasAdded
                      ? `Loaded ${sch.canvasAdded} assignment${sch.canvasAdded === 1 ? '' : 's'}/quiz${sch.canvasAdded === 1 ? '' : 'zes'} from Canvas into the schedule.`
                      : null;
                    const canvasErrorLine = sch.canvasLoadError
                      ? `Couldn't pull Canvas assignments: ${sch.canvasLoadError}. Click Refresh above to retry.`
                      : null;

                    if (!sch.hadSource) {
                      const diag = sch.sourceDiag;
                      const foundSource = diag && (
                        /found/i.test(diag.localStorage || '') ||
                        /found/i.test(diag.sourceCanvasFiles || '') ||
                        /found/i.test(diag.targetCanvasFiles || '')
                      );
                      return (
                        <span>
                          <Check size={12} style={{ display: 'inline', marginRight: 6, verticalAlign: '-2px' }} />
                          Canvas content copied. {canvasLine || 'No assignments returned from Canvas yet — try Refresh.'}
                          {canvasErrorLine && <span style={{ display: 'block', marginTop: 4, color: T.ox }}>{canvasErrorLine}</span>}
                          {sch.error ? (
                            <span style={{ display: 'block', marginTop: 6, color: T.ox, fontSize: '12px', lineHeight: 1.5 }}>
                              <strong>Import error:</strong> <code style={{ fontFamily: FONT_MONO }}>{sch.error}</code>
                              <span style={{ display: 'block', marginTop: 4, color: T.muted }}>
                                Source planner state was found, but importing it onto the new semester failed. The Canvas-side
                                copy still completed (assignments/quizzes/files/etc. are present).
                              </span>
                            </span>
                          ) : foundSource ? (
                            <span style={{ display: 'block', marginTop: 6, color: T.ox, fontSize: '12px', lineHeight: 1.5 }}>
                              Source planner state was found, but the import didn't run. Diagnostic below.
                            </span>
                          ) : (
                            <span style={{ display: 'block', marginTop: 6, color: T.muted, fontSize: '11px', lineHeight: 1.5 }}>
                              <strong>Notes &amp; modules didn't come over.</strong> A saved planner schedule for the source course
                              wasn't found in any of the locations we check. Only the Canvas-side content (assignments, quizzes, files,
                              pages, modules, discussions) was duplicated by Canvas's course-copy.<br />
                              <strong>To enable notes-carryover for future clones:</strong> switch to the source course in this planner,
                              then click <strong>Publish</strong> at the top — that uploads <code style={{ fontFamily: FONT_MONO }}>schedule-planner.json</code>
                              to the source's Canvas Files, where this tool can fetch it from any device. Then re-run the copy.
                            </span>
                          )}
                          {diag && (
                            <div style={{
                              marginTop: 8, padding: '8px 10px', borderRadius: 3,
                              background: T.subtle, border: `1px solid ${T.border}`,
                              fontFamily: FONT_MONO, fontSize: '10px', color: T.ink, lineHeight: 1.6,
                            }}>
                              <div style={{ fontWeight: 600, marginBottom: 4, color: T.muted, letterSpacing: '0.04em' }}>
                                WHAT WE CHECKED
                              </div>
                              <div>· This browser's localStorage: <span style={{ color: T.inkBlue }}>{diag.localStorage}</span></div>
                              <div>· Source course's Canvas Files: <span style={{ color: T.inkBlue }}>{diag.sourceCanvasFiles}</span></div>
                              <div>· Target's Canvas Files (post-migration): <span style={{ color: T.inkBlue }}>{diag.targetCanvasFiles}</span></div>
                            </div>
                          )}
                        </span>
                      );
                    }
                    // In compress/expand mode the day-count comparison is
                    // meaningless (a 14-week → 7-week copy expects fewer
                    // target days), so we only flag truncation in literal mode.
                    const truncated = sch.mode === 'literal' && sch.sourceTotalDays > sch.mappedDays;
                    const extraSuffix = sch.extraDays
                      ? ` plus ${sch.extraDays} extra day${sch.extraDays === 1 ? '' : 's'}`
                      : '';
                    const rewriteSuffix = sch.rewrittenNotes
                      ? ` ${sch.rewrittenNotes} note${sch.rewrittenNotes === 1 ? '' : 's'} had embedded links rewritten.`
                      : '';
                    const datesSuffix = sch.datePushed
                      ? ` ${sch.datePushed} Canvas due date${sch.datePushed === 1 ? '' : 's'} synced to the planner.`
                      : '';
                    return (
                      <span>
                        <Check size={12} style={{ display: 'inline', marginRight: 6, verticalAlign: '-2px' }} />
                        Copy complete: imported <strong>{sch.itemCount}</strong> planner items
                        across <strong>{sch.mappedDays}</strong> teaching days{extraSuffix}
                        {' '}({sch.relinked} assignment{sch.relinked === 1 ? '' : 's'} re-linked to the new course).
                        {rewriteSuffix && <span> {rewriteSuffix}</span>}
                        {datesSuffix && <span> {datesSuffix}</span>}
                        {sch.mode === 'compress' && (
                          <span style={{ display: 'block', marginTop: 4, color: T.muted }}>
                            Compressed: two source weeks of content stacked onto each target week (semester → term).
                          </span>
                        )}
                        {sch.mode === 'expand' && (
                          <span style={{ display: 'block', marginTop: 4, color: T.muted }}>
                            Expanded: each source week mapped to the first of a pair of target weeks; alternating weeks are blank.
                          </span>
                        )}
                        {canvasLine && <span style={{ display: 'block', marginTop: 4 }}>{canvasLine}</span>}
                        {canvasErrorLine && <span style={{ display: 'block', marginTop: 4, color: T.ox }}>{canvasErrorLine}</span>}
                        {truncated && (
                          <span style={{ display: 'block', marginTop: 4, color: T.ox }}>
                            Source semester had {sch.sourceTotalDays} teaching days but this one only has {sch.mappedDays} —
                            items past the end were dropped.
                          </span>
                        )}
                        {sch.droppedExtras > 0 && (
                          <span style={{ display: 'block', marginTop: 4, color: T.ox }}>
                            {sch.droppedExtras} extra day{sch.droppedExtras === 1 ? '' : 's'} fell outside the new semester window and were skipped.
                          </span>
                        )}
                        {sch.warnings && sch.warnings.length > 0 && (
                          <CloneWarnings warnings={sch.warnings} />
                        )}
                      </span>
                    );
                  })()}
                  {cloneStatus.state === 'stopped' && (
                    <span>
                      Stopped polling. The copy is still running on Canvas — check the destination course directly,
                      or click Refresh once it has finished.
                    </span>
                  )}
                  {cloneStatus.running && cloneStatus.state !== 'failed' && cloneStatus.state !== 'completed' && (
                    <span style={{ fontFamily: FONT_MONO }}>
                      {cloneStatus.state === 'resetting'
                        ? 'Resetting target course content via Canvas (this can take a few seconds)…'
                        : cloneStatus.state === 'deleting'
                          ? `Deleting Canvas content: ${cloneStatus.done || 0}/${cloneStatus.total || 0} (per-item DELETEs — Course Reset wasn't allowed)`
                        : cloneStatus.state === 'pushing-dates'
                        ? `Pushing due dates to Canvas: ${cloneStatus.done || 0}/${cloneStatus.total || 0} (throttled to avoid rate limits)`
                        : cloneStatus.state === 'syncing'
                          ? 'Canvas copy done — building remap and merging planner schedule…'
                          : cloneStatus.state === 'loading-canvas'
                            ? 'Loading assignments + groups from the new course…'
                            : `Still running — ${cloneStatus.state || 'starting'}, ${Math.round(cloneStatus.completion || 0)}%`}
                      {' · '}elapsed {fmtElapsed(cloneStatus.elapsedSec || 0)}
                    </span>
                  )}
                </div>
              )}
            </div>
            );
          })()}
        </div>

        {/* ── Import ── */}
        {onImport && (
          <div style={{ marginTop: 24, paddingTop: 20, borderTop: `1px solid ${T.border}` }}>
            <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: '16px', fontWeight: 600, marginBottom: 12 }}>Import &amp; templates</h3>
            <Field label="Import from file">
              <div className="flex items-center gap-3 flex-wrap">
                <label style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '7px 14px', borderRadius: 3, cursor: 'pointer',
                  fontFamily: FONT_BODY, fontSize: '13px', fontWeight: 500,
                  border: `1px solid ${T.border}`,
                  background: T.paper, color: T.ink,
                }}>
                  <input type="file" accept=".ics,.csv" onChange={handleFileImport}
                    style={{ display: 'none' }} />
                  <Upload size={14} /> Import file
                </label>
                <span style={{ fontSize: '12px', color: T.muted, fontFamily: FONT_BODY }}>
                  iCal (.ics) or CSV (date, title columns)
                </span>
              </div>
            </Field>
            <div className="mt-3">
              <Field label="Semester template">
                <div className="flex items-center gap-3 flex-wrap">
                  <ActionButton onClick={onExportTemplate}>
                    <Download size={14} /> Export template
                  </ActionButton>
                  <label style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '7px 14px', borderRadius: 3, cursor: 'pointer',
                    fontFamily: FONT_BODY, fontSize: '13px', fontWeight: 500,
                    border: `1px solid ${T.border}`,
                    background: T.paper, color: T.ink,
                  }}>
                    <input type="file" accept=".json" onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file && onImportTemplate) onImportTemplate(file);
                      e.target.value = '';
                    }} style={{ display: 'none' }} />
                    <Upload size={14} /> Import template
                  </label>
                </div>
                <p style={{ fontSize: '12px', color: T.muted, fontFamily: FONT_BODY, marginTop: 6 }}>
                  Reuse a schedule across semesters. Items are mapped by week &amp; day position, not absolute dates.
                </p>
              </Field>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
