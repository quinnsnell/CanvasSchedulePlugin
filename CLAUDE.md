# CLAUDE.md

This file gives Claude (or any AI coding assistant) context for working on this project. Read this first before making changes.

## What this is

A Canvas LMS course-schedule planner. It generates a 2-column grid (date | content) with one row per class meeting day in a semester. The instructor drags assignments and rich-text reading notes between days; assignment moves sync back to Canvas as `PUT` requests against the assignment's `due_at`.

The app exists because Canvas's native syllabus and calendar pages don't offer a class-day-row layout with drag-and-droppable rich content per day — a workflow that some legacy LMS tools (and many instructors who used them) relied on.

## How it's built

- **Single-page React app** (Vite + React 18). No backend.
- **Canvas API** is called directly from the browser using a user-supplied Personal Access Token. Requests go to `<canvasBaseUrl>/api/v1/...` with `Authorization: Bearer <token>`.
- **Persistence** uses `localStorage` when hosted, or `window.storage` when running inside a claude.ai artifact. The `Store` object handles both via a runtime check.
- **Drag-and-drop** uses `@dnd-kit/core` + `@dnd-kit/sortable` for touch-friendly DnD (pointer, touch, and keyboard sensors).
- **Styling** is mostly inline styles against a small theme object `T`. Tailwind v4 (PostCSS build via `@tailwindcss/postcss`) provides layout utility classes. Responsive layout via CSS media queries in `src/styles.js`.

## File map

```
.
├── index.html                  # Vite entry
├── package.json
├── vite.config.js              # base: './' for sub-path deploys
├── postcss.config.js           # Tailwind v4 + autoprefixer
├── README.md                   # human-facing
├── CLAUDE.md                   # you are here
├── CONTRIBUTING.md             # contributor guide
├── CODE_OF_CONDUCT.md
├── dev.sh                      # start dev server with Canvas URL env
├── .github/
│   ├── workflows/ci.yml        # build + test CI
│   ├── ISSUE_TEMPLATE/         # bug report + feature request templates
│   └── PULL_REQUEST_TEMPLATE.md
├── cors-proxy/
│   ├── worker.js               # Cloudflare Worker CORS proxy (~50 lines)
│   └── wrangler.toml           # Wrangler config for deployment
└── src/
    ├── main.jsx                # ReactDOM.createRoot + ErrorBoundary
    ├── index.css               # Tailwind v4 import + box-sizing reset
    ├── theme.js                # Light/dark palettes, fonts, setTheme(), GROUP_COLORS
    ├── styles.js               # App-level CSS (responsive, print, a11y)
    ├── utils.js                # Day codes, date math, iCal/CSV parse, templates, Store
    ├── canvas-api.js           # CORS proxy config, Canvas REST API client (paginated)
    ├── render-schedule-html.js # Static HTML table for Canvas Page publish
    ├── App.jsx                 # Main component: state, handlers, layout
    ├── __tests__/
    │   └── utils.test.js       # 68 unit tests for utils.js
    └── components/
        ├── ui.jsx              # Shared primitives: Field, IconButton, ActionButton, etc.
        ├── Header.jsx          # App toolbar: title, search, action buttons
        ├── ScheduleTable.jsx   # Schedule grid: column headers + day rows
        ├── ClassDayRow.jsx     # One schedule row + AddDayPopover
        ├── ItemCard.jsx        # Assignment/note card + RichEditor
        ├── UnscheduledZone.jsx # Sidebar drop target
        ├── PublishBanner.jsx   # Publish success banner + ActivityLog
        └── Panels.jsx          # SetupPanel, ShiftModal, ConflictModal, RecurringModal, EmptyState
```

| Module | Purpose |
|---|---|
| `theme.js` | LIGHT/DARK palettes, `T` (mutable current palette), `setTheme()`, font constants, GROUP_COLORS |
| `styles.js` | App-level CSS string (responsive breakpoints, print styles, accessibility, animations) |
| `utils.js` | Day-of-week codes, date math, iCal generation/parsing, CSV parsing, semester templates, `Store` persistence |
| `canvas-api.js` | CORS proxy URL management, `canvasFetch()`/`canvasFetchAll()` (paginated), `CanvasAPI` methods |
| `render-schedule-html.js` | Pure function: generates static HTML table for Canvas Page publish (dark mode responsive) |
| `App.jsx` | `ClassPlannerApp` — owns all state, undo stack, Canvas sync, renders layout |
| `components/ui.jsx` | `Field`, `IconButton`, `ToggleButton`, `ActionButton`, `ToolbarBtn`, `DayToolBtn`, style helpers |
| `components/Header.jsx` | App header with course title, metadata, collapsible search, and toolbar buttons |
| `components/ScheduleTable.jsx` | Schedule grid table with column headers, module headers, and day rows |
| `components/ClassDayRow.jsx` | One row of the schedule grid (date column + content column + day tools) |
| `components/ItemCard.jsx` | Renders an assignment or rich-text card; includes `RichEditor` and `DragOverlayCard` |
| `components/UnscheduledZone.jsx` | Sidebar drop target for items without a date |
| `components/PublishBanner.jsx` | Publish success banner with copy-link, and `ActivityLog` publish history |
| `components/Panels.jsx` | `SetupPanel` (semester + Canvas connection + import/templates), `ShiftModal`, `ConflictModal`, `RecurringModal`, `EmptyState` |

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
    courses: [{ id, name }],
    assignmentGroups: { [groupId]: { id, name, color } }
  },
  items: {
    [id]: {
      id,
      type: 'assign' | 'rich',
      // assign:
      title?, points?, canvasId?, htmlUrl?, dueDate?, isDemo?, groupId?,
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
  publishHistory: [{ timestamp, itemCount, dayCount }],
  loadedAt: ISO timestamp,                 // when last refreshed from Canvas (for conflict detection)
  studentView: bool,
}
```

Teaching days are derived from `setup`, never stored. The grid renders `allDays = sort(union(teachingDays, extraDays))`.

## Canvas integration flow

### Connect
User enters Canvas base URL + Personal Access Token in the Course Setup panel. We call `GET /api/v1/courses?enrollment_type=teacher` to populate the course picker.

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

- **CORS**: Canvas API blocks cross-origin browser requests. In production, requests route through a Cloudflare Worker CORS proxy (`cors-proxy/worker.js`). The proxy URL is configurable per-institution via the setup panel, `VITE_CORS_PROXY` env var, or localStorage. In dev, Vite's built-in proxy handles it.
- **Token safety**: Personal Access Token sits in `localStorage`. Acceptable for a single-instructor tool on their own machine. **Do NOT deploy this multi-tenant** — switch to OAuth2 or an LTI 1.3 integration if multiple instructors will use it.
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

- **Full LTI 1.3** instead of token-based auth (much bigger effort; only do this if going multi-instructor).

## Quick reference: where to change common things

| I want to… | Edit… |
|---|---|
| Change colors | LIGHT/DARK palettes in `src/theme.js` |
| Change fonts | `FONT_DISPLAY` / `FONT_BODY` / `FONT_MONO` in `src/theme.js` + the `@import` in `src/styles.js` |
| Tweak week banding | Search `weekShade` and `isWeekStart` in `components/ClassDayRow.jsx` |
| Add a Canvas API call | Add to `CanvasAPI` in `src/canvas-api.js` |
| Adjust mobile breakpoints | `src/styles.js`, look for `@media` |
| Add a new item type | Extend `items[id].type` and update `components/ItemCard.jsx` to render it |
| Add a shared button variant | Add to `components/ui.jsx` |
| Change CORS proxy default | `CORS_PROXY_DEFAULT` in `src/canvas-api.js` |
