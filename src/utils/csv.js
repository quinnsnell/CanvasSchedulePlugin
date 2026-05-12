/**
 * Simple CSV parsing for instructor schedule imports.
 *
 * Recognized columns (case-insensitive): date (required),
 * title/summary/name/event (one of these required),
 * description/desc/notes/details (optional).
 *
 * Handles quoted fields containing commas/newlines and several common
 * date formats (YYYY-MM-DD, YYYY/MM/DD, M/D/YYYY).
 */

/** Returns [{ title, date: 'YYYY-MM-DD', description? }]. */
export function parseCSV(text) {
  const rows = parseCSVRows(text);
  if (rows.length < 2) return [];

  // Map headers to column indices (case-insensitive)
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const dateIdx = headers.findIndex((h) => h === 'date');
  const titleIdx = headers.findIndex((h) => h === 'title' || h === 'summary' || h === 'name' || h === 'event');
  const descIdx = headers.findIndex((h) => h === 'description' || h === 'desc' || h === 'notes' || h === 'details');

  if (dateIdx < 0 || titleIdx < 0) return [];

  const events = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rawDate = (row[dateIdx] || '').trim();
    const title = (row[titleIdx] || '').trim();
    if (!rawDate || !title) continue;

    const date = normalizeDate(rawDate);
    if (!date) continue;

    const ev = { title, date };
    if (descIdx >= 0 && row[descIdx]?.trim()) {
      ev.description = row[descIdx].trim();
    }
    events.push(ev);
  }
  return events;
}

/** Split CSV text into rows of fields, respecting quoted fields. */
function parseCSVRows(text) {
  const rows = [];
  let current = [];
  let field = '';
  let inQuotes = false;
  const chars = text.replace(/\r\n/g, '\n');

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (inQuotes) {
      if (ch === '"') {
        if (chars[i + 1] === '"') {
          field += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        current.push(field);
        field = '';
      } else if (ch === '\n') {
        current.push(field);
        field = '';
        if (current.some((f) => f.trim())) rows.push(current);
        current = [];
      } else {
        field += ch;
      }
    }
  }
  // Last field/row
  current.push(field);
  if (current.some((f) => f.trim())) rows.push(current);
  return rows;
}

/** Normalize various date formats to YYYY-MM-DD. */
function normalizeDate(str) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(str)) return str.replace(/\//g, '-');
  const mdy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (mdy) {
    return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
  }
  // Date.parse fallback (handles e.g. "Jan 15 2026")
  const d = new Date(str);
  if (!isNaN(d)) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return null;
}
