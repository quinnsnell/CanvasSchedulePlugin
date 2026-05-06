# Contributing to Class Day Planner

Thanks for your interest in contributing! This is a small, focused project so the process is lightweight.

## Dev environment setup

```bash
git clone https://github.com/<your-fork>/CanvasSchedulePlugin.git
cd CanvasSchedulePlugin
npm install
npm run dev
```

The app runs at http://localhost:5173. To connect to Canvas during development, Vite's built-in proxy handles CORS -- just enter your Canvas URL and token in the app's cloud panel.

## Project structure

```
src/
  main.jsx              # Entry point
  App.jsx               # Main component: all state, handlers, layout
  theme.js              # Light/dark palettes, fonts
  utils.js              # Date math, persistence (Store), iCal export
  canvas-api.js         # Canvas REST API client + CORS proxy config
  components/
    ui.jsx              # Shared primitives (Field, IconButton, ActionButton, etc.)
    ClassDayRow.jsx     # One row of the schedule grid
    ItemCard.jsx        # Assignment or rich-text card
    UnscheduledZone.jsx # Sidebar drop target
    Panels.jsx          # SetupPanel, CanvasPanel, ShiftModal, EmptyState
cors-proxy/
  worker.js             # Cloudflare Worker CORS proxy
```

See [CLAUDE.md](./CLAUDE.md) for a detailed file map, data model, and Canvas integration flow.

## Code conventions

- **Styling**: Inline styles + Tailwind utility classes. No CSS modules or CSS-in-JS. Don't introduce new styling approaches.
- **Theme colors**: All colors live in `LIGHT`/`DARK` palettes in `src/theme.js`. Don't use ad-hoc hex codes -- extend the palette if you need a new color.
- **Fonts**: `FONT_DISPLAY` (Fraunces), `FONT_BODY` (Geist), `FONT_MONO` (JetBrains Mono) -- all defined in `src/theme.js`.
- **State updates**: Always use `updateState((s) => ...)` which clones state via `structuredClone`. Never mutate state directly.
- **Undo**: `updateState` auto-snapshots. Pass `skipUndo=true` only for non-undoable bookkeeping.
- **Component size**: Keep components focused. Split when a file exceeds ~400 lines.
- **JSDoc headers**: Each component file has one explaining its purpose. Maintain this when adding new files.

## How to submit a PR

1. Fork the repo and create a feature branch from `main`
2. Make your changes
3. Test in the browser -- verify no console errors
4. If you touched Canvas API calls, test with a real Canvas instance if possible
5. Push your branch and open a Pull Request against `main`
6. Fill out the PR template

Keep PRs focused on a single change. If you're tackling something from the "Outstanding work" list in CLAUDE.md, mention that in the PR description.

## Reporting bugs and requesting features

Use the GitHub issue templates. Check existing issues first to avoid duplicates.

## Code of conduct

This project follows the [Contributor Covenant Code of Conduct](./CODE_OF_CONDUCT.md). By participating, you agree to uphold it.
