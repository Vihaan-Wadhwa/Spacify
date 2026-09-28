# Spacify

Browser-based 3D home design: upload a floor-plan sketch (or add rooms by hand), see it in 3D, switch to a to-scale 2D plan, walk through it with WASD, and ask the AI assistant for design ideas.

This is the Next.js (App Router, TypeScript) version of the original `spacify.html` + `spacify-3d.html` build — **Task 1** of the implementation plan.

## Run it

```bash
npm install
cp .env.example .env.local   # then fill in the webhook URLs
npm run dev                   # http://localhost:3000
```

- `/` — landing page
- `/design` — the 3D builder (`/design?demo=1` opens with sample rooms)

| Env var | Used by | Notes |
|---|---|---|
| `N8N_SKETCH_WEBHOOK_URL` | `/api/sketch` | n8n workflow that turns a sketch image into rooms JSON |
| `N8N_CHAT_WEBHOOK_URL` | `/api/chat` | Optional. Without it the assistant uses built-in canned answers |

Both are read **on the server only**, so the browser never sees them and the old `corsproxy.io` hop is gone.

## Project structure

```
app/
  layout.tsx            fonts (self-hosted DM Sans / DM Serif Display), theme
  globals.css           design tokens (dark + light)
  page.tsx, landing.css landing page
  design/page.tsx       design page → <DesignStudio />
  design/studio.css     design-page styles (scoped under .studio)
  api/
    sketch/route.ts     sketch image → n8n → validated rooms (zod)
    chat/route.ts       AI assistant (n8n or fallback answers)
    projects/…          501 stubs — Postgres (Task 3/4)
    rooms/route.ts      501 stub  — Postgres
    design/route.ts     501 stub  — MongoDB
    ai/route.ts         501 stub  — ChromaDB
components/
  ThemeProvider.tsx, ThemeToggleButton.tsx
  landing/              Reveal (scroll fade-in), StartForm
  design/
    DesignStudio.tsx    owns all project + UI state
    ThreeCanvas.tsx     client-only wrapper around the Three.js scene
    RoomPanel.tsx       room list, add room, floors
    DesignPanel.tsx     wall colour, flooring, ceiling height
    CanvasOverlays.tsx  layer toggles, camera presets, zoom
    PlanView.tsx        2D plan + PNG export
    ChatView.tsx        AI assistant
    UploadFlow.tsx      upload card + analysis overlay
    TutorialModal.tsx   sketch tutorial
    Topbar.tsx
lib/
  rooms.ts              Room type, colours, defaults, auto-layout
  scene/SpacifyScene.ts the Three.js scene (orbit, picking, walkthrough, export)
  plan.ts               2D plan drawing
  browser.ts            image compression, downloads
  server/               sketch parsing, chat prompt/fallbacks, HTTP helpers
```

React owns the state; `SpacifyScene` only draws it. `DesignStudio` passes rooms, floors, layers, per-room designs and the selection down to `<ThreeCanvas />`, which pushes them into the scene.

## Changes from the HTML version

- Room designs (wall colour, flooring) now survive rebuilds. Before, changing any dimension or toggling a layer reset them.
- Manual room entry works again (the old `addRoom()` referenced a select that no longer existed).
- Sketch results with `floor: 2` or `3` now bump the floor count, and the AI's JSON is validated before it reaches the 3D builder.
- The 2D plan can show any floor, not just floor 1, and is sharp on high-DPI screens.
- Pressing Esc in walkthrough now exits properly (browsers swallow that key while the pointer is locked), and the first mouse-look jump after locking is ignored.
- Chat messages are rendered as text rather than `innerHTML`.
- Three.js moved from the r128 CDN script to the npm package (lighting scaled to match the old look). GPU memory is freed on every rebuild.
- Theme choice persists across pages and reloads.
- Usable on phones: panels overlay the canvas and controls reflow.

## Next (from the plan)

Task 3.1–3.2 Postgres + Prisma → Task 4 auth and saved projects → Task 3.3–3.6 MongoDB + ChromaDB → Tasks 2 and 5 (sketch AI and RAG chat).
