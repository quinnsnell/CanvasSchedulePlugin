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
├── index.html              # Vite entry, includes Tailwind CDN
├── package.json
├── vite.config.js          # base: './' for sub-path deploys
├── README.md               # human-facing
├── CLAUDE.md               # you are here
└── src/
    ├── main.jsx            # ReactDOM.createRoot
    ├── index.css           # box-sizing reset only
    └── App.jsx             # everything (~1300 lines, single-file by intention)
```

`App.jsx` is organized top-to-bottom as:

| Section | Purpose |
|---|---|
| `T`, `FONT_*` | Theme constants (warm/scholarly: cream, ink, ink-blue accent, sienna, amber for added days) |
| `DAY_CODES`, `DAY_FULL`, `DAY_SHORT` | Day-of-week mappings |
| `generateClassDays`, `computeAllDays`, `getAddableDatesAfter`, `weekKey` | Date math |
| `Store` | Persistence wrapper (window.storage → localStorage fallback) |
| `CanvasAPI` | `listCourses`, `listAssignments`, `setDueDate` |
| `freshDemoState` | Demo seed for empty installs (CS 301 algorithms course) |
| `ClassPlannerApp` | Default export. Top-level component, owns all state |
| `ClassDayRow` | One row of the schedule grid |
| `AddDayPopover` | Picker for adding a non-teaching date |
| `UnscheduledZone` | Sidebar drop target for items without a date |
| `ItemCard` | Renders an assignment or rich-text item |
| `RichEditor` | contentEditable-based editor with bold/italic/list/link toolbar |
| `SetupPanel`, `CanvasPanel` | Config drawers |
| Small UI primitives | `IconButton`, `ToggleButton`, `ActionButton`, `ToolbarBtn`, `DayToolBtn`, `EmptyState`, `Field` |

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
  pendingCreations: [{ id, date, time }],  // tracks "+ Assignment" clicks awaiting Canvas creation
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

- **CORS**: Canvas API may block cross-origin browser requests depending on the institution's config. Symptoms: connect/refresh fails silently or with a CORS error in console. Solution: deploy a tiny proxy backend (Node, Cloudflare Worker, etc.) that forwards `Authorization` and proxies the responses with permissive CORS headers. Keep it under 50 lines.
- **Token safety**: Personal Access Token sits in `localStorage`. Acceptable for a single-instructor tool on their own machine. **Do NOT deploy this multi-tenant** — switch to OAuth2 or an LTI 1.3 integration if multiple instructors will use it.
- **Mobile drag-and-drop**: HTML5 DnD is unreliable on touch. If full mobile editing matters, swap in `@dnd-kit/core` (recommended) or add explicit "Move to…" dropdowns on cards.
- **Tailwind via CDN**: convenient for getting started but adds a runtime dependency on a third-party CDN. For production, swap to a PostCSS-based Tailwind build.
- **`document.execCommand`** is used by the rich-text editor. It's deprecated but still works in all major browsers in 2026. If it breaks, swap to `tiptap` or `lexical`.

## Deployment

`npm run build` produces `dist/`. Host on any static service. Embed in Canvas via iframe in a Page. Your Canvas admin may need to whitelist the host for iframe embedding (most Canvas instances allow same-institution domains by default, but external ones often don't).

## Conventions

- **Theme colors** live in the `T` object at the top of `App.jsx`. Don't introduce ad-hoc hex codes — extend `T` first.
- **Fonts**: `FONT_DISPLAY` (Fraunces) for headers/dates, `FONT_BODY` (Geist) for content, `FONT_MONO` (JetBrains Mono) for metadata/labels.
- **Single-file**: keep it that way unless growth genuinely warrants splitting. The whole app fits comfortably in one mental model right now.
- **Inline styles + Tailwind utilities**: don't introduce a CSS-in-JS library or a `styles.module.css`. We picked this for portability.
- **State updates** go through `updateState((s) => ...)` which `structuredClone`s the state. Don't mutate `state` directly outside this helper.

## Outstanding work / good first issues

- **Reorder items within a day's cell.** Currently dropping on a cell appends to the end. Adding insertion-position handling would let users reorder readings vs. assignments.
- **"Move to…" tap menu** on cards for touch devices — would unlock mobile editing.
- **Student view URL anchor** (`#student`) so a Canvas-embedded iframe can render read-only without the toggle.
- **Holidays / breaks**: mark a teaching day as no-class without removing it (e.g., spring break Mondays).
- **Module / unit headers**: optional grouping rows above blocks of weeks.
- **iCal export** so students can subscribe.
- **Print stylesheet** for a paper handout version.
- **Full LTI 1.3** instead of token-based auth (much bigger effort; only do this if going multi-instructor).
- **Reorder calls during the same day on +Day popover** — currently it always lists from "today + 1" forward; could allow inserting before the first day too.
- **Tailwind PostCSS build** to drop the CDN dependency.

## Quick reference: where to change common things

| I want to… | Edit… |
|---|---|
| Change colors | `T` object near the top of `App.jsx` |
| Change fonts | `FONT_DISPLAY` / `FONT_BODY` / `FONT_MONO` constants + the `@import` in the inline `<style>` |
| Tweak week banding | Search `weekShade` and `isWeekStart` in `ClassDayRow` |
| Add a Canvas API call | Add to the `CanvasAPI` object; uses `canvasFetch` helper |
| Adjust mobile breakpoints | The `<style>` block inside the main component, look for `@media` |
| Change demo data | `freshDemoState()` near the top |
| Add a new item type | Extend `items[id].type` and update `ItemCard` to render it |
