# Class Day Planner

A Canvas LMS companion that gives instructors a class-day-by-class-day grid for planning a semester. Drag assignments between days (syncs to Canvas), drop reading notes and material links on each meeting, see weeks at a glance.

Built because Canvas's native calendar and syllabus pages don't replicate the spreadsheet-style course planner that some other LMS tools offer — rows for class meetings, with rich-text content and draggable assignments per day.

## Features

- Set semester start/end and which weekdays you teach → grid auto-generates one row per class meeting
- Each row has a date column and a content column with draggable assignment cards and rich-text reading notes
- **Drag assignments** to a different day → Canvas due date updates via API
- **+ Note** on each day → creates a rich-text box right on that day (bold/italic/lists/links)
- **+ Day** on each day → popover with the non-teaching dates between this day and the next class meeting (e.g., for a Tu/Th teacher, clicking on a Thursday shows Fri/Sat/Sun/Mon)
- **+ Assignment** on each day → opens Canvas's create-assignment page; when you save and return to the planner tab, the new assignment auto-lands on that day
- **Off-day Canvas due dates** auto-add their date to the schedule, marked with an amber "Added date" pill
- **Week banding**: alternating background tint, 2px boundary rule between weeks, and "Week N" labels in the date column
- **Editor / Student view** toggle (student view is read-only with no controls)
- **Responsive**: works in narrow Canvas iframes (~700px) and on mobile

## Quick start

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

## Configure inside the app

1. Click the **gear icon** → set course title, semester start/end dates, and which weekdays you teach
2. Click the **cloud icon** → enter your Canvas base URL (e.g., `https://canvas.youruniversity.edu`) and a Personal Access Token (Account → Settings → "+ New Access Token" inside Canvas)
3. Pick your course from the dropdown → click **Refresh** to import all assignments

## Deploy

```bash
npm run build
```

Upload `dist/` to any static host (GitHub Pages, Netlify, Vercel, your university web space). Then in Canvas, create a Page and embed:

```html
<iframe src="https://your-host/" width="100%" height="900" style="border:0"></iframe>
```

Your Canvas admin may need to whitelist the host domain for iframe embedding.

### GitHub Pages deploy

```bash
npm run build
# copy dist/ contents to a gh-pages branch, or use a workflow like peaceiris/actions-gh-pages
```

The `vite.config.js` uses `base: './'` so the build works whether served from `/` or `/repo-name/`.

## Architecture

Single React component, single file: `src/App.jsx`. See [CLAUDE.md](./CLAUDE.md) for a detailed map for AI assistants and future contributors.

## Caveats

- **CORS**: Canvas API may block cross-origin browser requests depending on your institution's config. If you hit CORS errors, you'll need a tiny proxy backend (a 30-line Node/Cloudflare Worker is plenty).
- **Token storage**: Personal Access Token is stored in browser localStorage. This is fine for your own machine but means anyone with browser access can see it. Don't deploy this multi-tenant.
- **Mobile drag**: HTML5 native drag-and-drop is unreliable on touch devices. Buttons and tap interactions work; full editing is best on desktop.

## License

Your choice — pick one and add a `LICENSE` file.
