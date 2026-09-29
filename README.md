# Spacify

Browser-based 3D home design: upload a floor-plan sketch (or add rooms by hand), see it in 3D, switch to a to-scale 2D plan, walk through it with WASD, and ask the AI assistant for design ideas.

Next.js (App Router, TypeScript) + Three.js, with projects stored in PostgreSQL.

## Run it

```bash
npm install
cp .env.example .env.local
docker compose up -d          # start PostgreSQL (or see "Database" below for other ways)
npm run db:setup              # create the tables and sample data
npm run dev                   # http://localhost:3000
```

- `/` — landing page
- `/projects` — your saved projects (and ones shared with you)
- `/design` — the 3D builder; **Save** (or Ctrl+S) stores the project, and the URL becomes `/design?project=<id>`
- `/design?demo=1` — sample rooms, not saved

The app works without a database too: you just can't save, and the projects page says why.

## Database (PostgreSQL)

The schema is plain SQL so every table, constraint and trigger is visible:

| File | What it is |
|---|---|
| `db/schema.sql` | The 8 tables from the DBMS report, with CHECK/UNIQUE/FK constraints, FK indexes, 3 triggers, the `project_access()` function and the `project_summary` view |
| `db/seed.sql` | Two users, two projects, one shared between them, plus furniture, exports and AI suggestions |
| `db/queries.sql` | 10 example queries for the report (joins, GROUP BY/HAVING, correlated subquery, LEFT JOIN, view, function, a trigger demo) |
| `db/reset.sql` | Drops everything (used by `npm run db:reset`) |

**Getting a PostgreSQL server** — pick one:

1. **Docker** (easiest): `docker compose up -d`. It matches the default `DATABASE_URL`.
2. **Installed locally** (postgresql.org/download). Then, once:
   ```bash
   psql -U postgres -c "CREATE USER spacify WITH PASSWORD 'spacify';" -c "CREATE DATABASE spacify OWNER spacify;"
   ```
3. **Free cloud database** (Neon or Supabase): create a project and paste its connection string into `DATABASE_URL`.

Then `npm run db:setup` (safe to re-run; it won't touch existing data). `npm run db:reset` wipes everything and starts again. To look inside: `psql postgres://spacify:spacify@localhost:5432/spacify`, then e.g. `\dt`, `\d rooms`, or `\i db/queries.sql`.

**What the app does with it**

- **Save** sends the whole project (name, floors, rooms) to `PUT /api/projects/:id` (or `POST /api/projects` the first time). In one transaction the server updates rooms that still exist, inserts new ones, deletes removed ones and stores each room's position on the 2D plan. The `trg_rooms_total_area` trigger then recalculates `projects.total_area`, and `trg_projects_updated_at` stamps `updated_at`.
- **Access control** runs in SQL: every read or write calls `project_access(user, project)`, which returns `owner`, `edit`, `view` or nothing, using `shared_projects`. A view-only project opens with Save disabled.
- **Exports** (2D or 3D PNG) of a saved project add a row to `exports`. **AI assistant answers** for a saved project go into `ai_suggestions` (only answers from the real chat workflow, not the built-in canned ones).
- **Wall colours and flooring aren't saved yet.** They go to MongoDB in Task 3.3.
- **There's no login yet (Task 4).** Everyone acts as the seeded `demo@spacify.in` account (`DEMO_USER_EMAIL`). All of this goes through `getCurrentUserId()` in `lib/server/currentUser.ts`, which is the only thing Task 4 needs to change.

**API**

| Method | Route | Needs | Does |
|---|---|---|---|
| GET | `/api/projects` | — | Projects you own or that are shared with you |
| POST | `/api/projects` | — | Create a project with its rooms |
| GET | `/api/projects/:id` | view | The project and its rooms |
| PUT | `/api/projects/:id` | edit | Save name, floors and rooms |
| DELETE | `/api/projects/:id` | owner | Delete it (rooms, furniture, exports, suggestions, shares cascade) |
| POST | `/api/projects/:id/exports` | view | Log a `2d`/`3d` export |
| GET / POST | `/api/rooms` | view / edit | List rooms (`?projectId=`) or add one |

### Sketch recognition with a local model (default)

Sketches are read by **Qwen2.5-VL** running on your own machine through [Ollama](https://ollama.com) — no API key, no per-request cost.

```bash
# 1. Install Ollama from https://ollama.com/download
# 2. Download the vision model (~6 GB, once)
ollama pull qwen2.5vl:7b
# 3. Make sure Ollama is running (the desktop app does this, or:)
ollama serve
```

Then upload a sketch at `/design`. The first upload is slowest while the model loads (it stays loaded for 10 minutes). Expect a few seconds per sketch on a GPU and up to a minute or two on CPU only. On a laptop without a GPU, `qwen2.5vl:3b` is faster (set `OLLAMA_VISION_MODEL`).

If something's wrong, the upload screen tells you what: Ollama not running, model not downloaded, or no rooms found.

| Env var | Default | Notes |
|---|---|---|
| `DATABASE_URL` | — | PostgreSQL connection string |
| `DEMO_USER_EMAIL` | `demo@spacify.in` | Who the app acts as until login exists |
| `SKETCH_PROVIDER` | `ollama` | `ollama` (local) or `n8n` (hosted workflow) |
| `OLLAMA_URL` | `http://localhost:11434` | |
| `OLLAMA_VISION_MODEL` | `qwen2.5vl:7b` | any Ollama vision model |
| `N8N_SKETCH_WEBHOOK_URL` | — | only used when `SKETCH_PROVIDER=n8n` |
| `N8N_CHAT_WEBHOOK_URL` | — | AI assistant; without it, built-in canned answers |

All of these are read on the server only. How it works: `lib/server/ollama.ts` sends the image with a prompt and a JSON schema (Ollama's structured output), so the model can only answer in the `{ rooms: [...] }` shape; `lib/server/sketch.ts` then validates and clamps every room with zod before it reaches the 3D builder.

## Project structure

```
app/
  layout.tsx            fonts (self-hosted DM Sans / DM Serif Display), theme
  globals.css           design tokens (dark + light)
  page.tsx, landing.css landing page
  design/page.tsx       design page; loads ?project=<id> from Postgres on the server
  design/studio.css     design-page styles (scoped under .studio)
  projects/page.tsx     "My projects" list (+ projects.css)
  api/
    sketch/route.ts     sketch image → Qwen (Ollama) or n8n → validated rooms (zod)
    chat/route.ts       AI assistant (n8n or fallback answers); logs to ai_suggestions
    projects/…          list, create, load, save, delete, log exports — Postgres
    rooms/route.ts      list / add single rooms — Postgres
    design/route.ts     501 stub  — MongoDB (Task 3.3)
    ai/route.ts         501 stub  — ChromaDB (Task 3.4)
db/                     schema.sql, seed.sql, queries.sql, reset.sql
scripts/db-setup.mjs    npm run db:setup / db:reset
components/
  ThemeProvider.tsx, ThemeToggleButton.tsx
  landing/              Reveal (scroll fade-in), StartForm
  projects/ProjectCard  one saved project, with delete
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
  projects.ts           project types + zod validation shared by browser and API
  scene/SpacifyScene.ts the Three.js scene (orbit, picking, walkthrough, export)
  plan.ts               2D plan drawing
  browser.ts            image compression, downloads
  server/
    db.ts               pg connection pool, query(), withTransaction()
    projects.ts         all project/room SQL, with access checks
    currentUser.ts      who's signed in (demo user until Task 4)
    errors.ts           turns DB/validation errors into clear messages
    ollama.ts, sketch.ts, chat.ts, http.ts
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

Done: Task 1 (Next.js), Task 2 (sketch recognition with local Qwen), Task 3.1–3.2 (PostgreSQL, using plain SQL + `pg` rather than Prisma so the SQL stays visible), and Task 4.4–4.5 (save and load projects).

Next: Task 4.1–4.3 login and register (fills in `sessions`, replaces the demo user) → Task 3.3 MongoDB for wall colours and flooring → Task 3.4 ChromaDB → Task 5 RAG chat.
