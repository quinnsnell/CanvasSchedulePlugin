# CLAUDE.md

This file gives Claude (or any AI coding assistant) context for working on this project. Read this first before making changes.

## What this is

A Canvas LMS course-schedule planner. It generates a 2-column grid (date | content) with one row per class meeting day in a semester. The instructor drags assignments and rich-text reading notes between days; assignment moves sync back to Canvas as `PUT` requests against the assignment's `due_at`.

The app exists because Canvas's native syllabus and calendar pages don't offer a class-day-row layout with drag-and-droppable rich content per day — a workflow that some legacy LMS tools (and many instructors who used them) relied on.

## How it's built

- **Single-page React app** (Vite + React 18). No backend.
- **Canvas API** is called directly from the browser using a user-supplied Personal Access Token. Requests go to `<canvasBaseUrl>/api/v1/...` with `Authorization: Bearer <token>`.
- **Persistence** uses `localStorage` when hosted, or `window.storage` when running inside a claude.ai artifact. The `Store` object handles both via a runtime check.
- **Drag-and-drop** uses HTML5 native (no library). Touch devices get a degraded experience — buttons still work but cards don't drag well. See "Outstanding work" below.
- **Styling** is mostly inline styles against a small theme object `T`. Tailwind core utility classes (loaded via the CDN in `index.html`) are used for layout helpers (flex/grid/gap/spacing). Responsive layout via CSS media queries inside a `<style>` block in `App.jsx`.

## File map

```
.
├── index.html                  # Vite entry, includes Tailwind CDN
├── package.json
├── vite.config.js              # base: './' for sub-path deploys
├── README.md                   # human-facing
├── CLAUDE.md                   # you are here
├── cors-proxy/
│   ├── worker.js               # Cloudflare Worker CORS proxy (~50 lines)
│   └── wrangler.toml           # Wrangler config for deployment
└── src/
    ├── main.jsx                # ReactDOM.createRoot + ErrorBoundary
    ├── index.css               # box-sizing reset only
    ├── theme.js                # Light/dark palettes, fonts, setTheme()
    ├── utils.js                # Day codes, date math, iCal, Store (persistence)
    ├── canvas-api.js           # CORS proxy config, Canvas REST API client
    ├── App.jsx                 # Main component: state, handlers, layout
    └── components/
        ├── ui.jsx              # Shared primitives: Field, IconButton, ActionButton, etc.
        ├── ClassDayRow.jsx     # Schedule row + AddDayPopover
        ├── ItemCard.jsx        # Assignment/note card + RichEditor
        ├── UnscheduledZone.jsx # Sidebar drop target
        └── Panels.jsx          # SetupPanel, CanvasPanel, ShiftModal, EmptyState
```

| Module | Purpose |
|---|---|
| `theme.js` | LIGHT/DARK palettes, `T` (mutable current palette), `setTheme()`, font constants |
| `utils.js` | Day-of-week codes, date math (`generateClassDays`, `computeAllDays`, `weekKey`, etc.), `Store` persistence, iCal generation |
| `canvas-api.js` | CORS proxy URL management, `canvasFetch()` wrapper, `CanvasAPI` methods (courses, assignments, files, pages, publish) |
| `App.jsx` | `ClassPlannerApp` — owns all state, undo stack, Canvas sync, renders layout |
| `components/ui.jsx` | `Field`, `IconButton`, `ToggleButton`, `ActionButton`, `ToolbarBtn`, `DayToolBtn`, style helpers |
| `components/ClassDayRow.jsx` | One row of the schedule grid (date column + content column + day tools) |
| `components/ItemCard.jsx` | Renders an assignment or rich-text card; includes `RichEditor` |
| `components/UnscheduledZone.jsx` | Sidebar drop target for items without a date |
| `components/Panels.jsx` | `SetupPanel`, `CanvasPanel`, `ShiftModal`, `EmptyState` |

## Data model

```js
state = {
  setup: {
    courseTitle: string,
    startDate: 'YYYY-MM-DD',
    endDate: 'YYYY-MM-DD',
    classDays: ['MO','WE','FR']     // any subset of DAY_CODES
  },
  canvas: {
    baseUrl, token, courseId,
    connected: bool,
    courses: [{ id, name }]
  },
  items: {
    [id]: {
      id,
      type: 'assign' | 'rich',
      // assign:
      title?, points?, canvasId?, htmlUrl?, dueDate?, isDemo?,
      // rich:
      html?
    }
  },
  schedule: { 'YYYY-MM-DD': [itemId, itemId, ...] },
  extraDays: ['YYYY-MM-DD', ...],   // explicit non-teaching dates added either manually or by off-day import
  unscheduled: [itemId, ...],       // items not placed on any day
  holidays: { 'YYYY-MM-DD': 'label' },     // days marked as no-class
  modules: { 'YYYY-MM-DD': 'title' },      // unit/module headers shown before a date
  pendingCreations: [{ id, date, time }],  // tracks "+ Assignment" clicks awaiting Canvas creation
  loadedAt: ISO timestamp,                 // when last refreshed from Canvas (for conflict detection)
  studentView: bool,
}
```

Teaching days are derived from `setup`, never stored. The grid renders `allDays = sort(union(teachingDays, extraDays))`.

## Canvas integration flow

### Connect
User enters Canvas base URL + Personal Access Token in the Canvas panel. We call `GET /api/v1/courses?enrollment_type=teacher` to populate the course picker.

### Refresh / import
`refreshFromCanvas()` calls `GET /api/v1/courses/:id/assignments`. For each assignment:
- If we already have it (matched by `canvasId`), update title/points/`htmlUrl`. If Canvas's `due_at` differs from our local `dueDate`, relocate the card.
- If new, create an item. Place on Canvas's `due_at` date. If that date isn't in `allDays`, add it to `extraDays` (auto-added date, amber row).
- New assignments with no `due_at` try to claim a `pendingCreation`: if one is waiting, adopt its date AND `PUT` Canvas's `due_at` to match — keeping planner and Canvas aligned.

### Drag → reschedule
`moveItem(id, toDate)` updates local state immediately. If the item has a `canvasId` and Canvas is connected, we `PUT /api/v1/courses/:id/assignments/:assignmentId` with `assignment.due_at = <toDate>T23:59:00`.

### "+ Assignment" button
Opens `<base>/courses/<id>/assignments/new` in a new tab and pushes a `pendingCreation` record. A `window` `focus` event listener triggers a re-import when the user returns; matching logic in `refreshFromCanvas` reconciles it.

## Important constraints

- **CORS**: Canvas API blocks cross-origin browser requests. In production, requests route through a Cloudflare Worker CORS proxy (`cors-proxy/worker.js`). The proxy URL is configurable per-institution via the Canvas panel UI, `VITE_CORS_PROXY` env var, or localStorage. In dev, Vite's built-in proxy handles it.
- **Token safety**: Personal Access Token sits in `localStorage`. Acceptable for a single-instructor tool on their own machine. **Do NOT deploy this multi-tenant** — switch to OAuth2 or an LTI 1.3 integration if multiple instructors will use it.
- **Mobile drag-and-drop**: HTML5 DnD is unreliable on touch. If full mobile editing matters, swap in `@dnd-kit/core` (recommended) or add explicit "Move to…" dropdowns on cards.
- **Tailwind via CDN**: convenient for getting started but adds a runtime dependency on a third-party CDN. For production, swap to a PostCSS-based Tailwind build.
- **`document.execCommand`** is used by the rich-text editor. It's deprecated but still works in all major browsers in 2026. If it breaks, swap to `tiptap` or `lexical`.

## Deployment

`npm run build` produces `dist/`. Host on any static service. Embed in Canvas via iframe in a Page. Your Canvas admin may need to whitelist the host for iframe embedding (most Canvas instances allow same-institution domains by default, but external ones often don't).

## Conventions

- **Theme colors** live in `src/theme.js` (LIGHT/DARK palettes). Don't introduce ad-hoc hex codes — extend the palette first.
- **Theme switching**: `T` is a mutable module export reassigned by `setTheme()`. Style helpers in `ui.jsx` are functions (not constants) so they pick up the current palette on each render.
- **Fonts**: `FONT_DISPLAY` (Fraunces) for headers/dates, `FONT_BODY` (Geist) for content, `FONT_MONO` (JetBrains Mono) for metadata/labels.
- **Modular components**: each component file has a JSDoc header explaining its purpose. Keep components focused — split further only when a file exceeds ~400 lines.
- **Inline styles + Tailwind utilities**: don't introduce a CSS-in-JS library or a `styles.module.css`. We picked this for portability.
- **State updates** go through `updateState((s) => ...)` which `structuredClone`s the state. Don't mutate `state` directly outside this helper.
- **Undo**: `updateState` auto-snapshots state before each change (up to 30 levels). Pass `skipUndo=true` for non-undoable bookkeeping (e.g., updating `loadedAt`).

## Outstanding work / good first issues

- **"Move to…" tap menu** on cards for touch devices — would unlock mobile editing.
- **Full LTI 1.3** instead of token-based auth (much bigger effort; only do this if going multi-instructor).
- **Tailwind PostCSS build** to drop the CDN dependency.
- **Multi-page assignment support** — Canvas API pagination (Link headers) for courses with 100+ assignments.

## Quick reference: where to change common things

| I want to… | Edit… |
|---|---|
| Change colors | LIGHT/DARK palettes in `src/theme.js` |
| Change fonts | `FONT_DISPLAY` / `FONT_BODY` / `FONT_MONO` in `src/theme.js` + the `@import` in `App.jsx`'s `<style>` |
| Tweak week banding | Search `weekShade` and `isWeekStart` in `components/ClassDayRow.jsx` |
| Add a Canvas API call | Add to `CanvasAPI` in `src/canvas-api.js` |
| Adjust mobile breakpoints | The `<style>` block in `App.jsx`, look for `@media` |
| Add a new item type | Extend `items[id].type` and update `components/ItemCard.jsx` to render it |
| Add a shared button variant | Add to `components/ui.jsx` |
| Change CORS proxy default | `CORS_PROXY_DEFAULT` in `src/canvas-api.js` |
