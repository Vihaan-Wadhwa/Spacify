# Spacify

Browser-based 3D home design: upload a floor-plan sketch (or add rooms by hand), arrange it on a to-scale 2D plan (move and resize rooms, place doors and windows), see it in 3D, walk through it with WASD, and ask the AI assistant for design ideas.

Next.js (App Router, TypeScript) + Three.js, with projects stored in PostgreSQL.

## Run it

```bash
npm install
cp .env.example .env.local
docker compose up -d          # start PostgreSQL (or see "Database" below for other ways)
npm run db:setup              # create the tables and sample data
npm run dev                   # http://localhost:3000
```

Then log in with a test account (from `db/seed.sql`) or create your own at `/register`:

| Email | Password | Sees |
|---|---|---|
| `demo@spacify.in` | `spacify123` | Sample 2BHK, plus Rahul's Villa under "Shared with me" (edit access) |
| `rahul@example.com` | `rahul123` | Rahul's Villa |

- `/` — landing page
- `/login`, `/register` — accounts
- `/projects` — your saved projects (and ones shared with you); needs a login
- `/design` — the 3D builder; **Save** (or Ctrl+S) stores the project, and the URL becomes `/design?project=<id>`; needs a login
- `/design?demo=1` — sample rooms, open to everyone; saving asks you to log in

Without a database, the landing page and the demo still work; logging in and saving don't.

## Database (PostgreSQL)

The schema is plain SQL so every table, constraint and trigger is visible:

| File | What it is |
|---|---|
| `db/schema.sql` | The 8 tables from the DBMS report plus `openings` (doors and windows), with CHECK/UNIQUE/FK constraints, FK indexes, 3 triggers, the `project_access()` function and the `project_summary` view |
| `db/seed.sql` | Two users, two projects, one shared between them, plus furniture, exports and AI suggestions |
| `db/queries.sql` | 13 example queries for the report (joins, GROUP BY/HAVING, correlated subquery, LEFT JOIN, view, function, a trigger demo, sessions) |
| `db/reset.sql` | Drops everything (used by `npm run db:reset`) |
| `db/upgrade.sql` | Adds `openings` to a database created before the plan editor (`npm run db:setup` runs it when needed) |

**Getting a PostgreSQL server** — pick one:

1. **Docker** (easiest): `docker compose up -d`. It matches the default `DATABASE_URL`.
2. **Installed locally** (postgresql.org/download). Then, once:
   ```bash
   psql -U postgres -c "CREATE USER spacify WITH PASSWORD 'spacify';" -c "CREATE DATABASE spacify OWNER spacify;"
   ```
3. **Free cloud database** (Neon or Supabase): create a project and paste its connection string into `DATABASE_URL`.

Then `npm run db:setup` (safe to re-run; it won't touch existing data, and it brings an older database up to date). `npm run db:reset` wipes everything and starts again. To look inside: `psql postgres://spacify:spacify@localhost:5432/spacify`, then e.g. `\dt`, `\d rooms`, or `\i db/queries.sql`.

**What the app does with it**

- **Save** sends the whole project (name, floors, rooms with their plan positions, doors and windows) to `PUT /api/projects/:id` (or `POST /api/projects` the first time). In one transaction the server updates rooms that still exist, inserts new ones, deletes removed ones, and rewrites each room's rows in `openings`. The `trg_rooms_total_area` trigger then recalculates `projects.total_area`, and `trg_projects_updated_at` stamps `updated_at`.
- **Access control** runs in SQL: every read or write calls `project_access(user, project)`, which returns `owner`, `edit`, `view` or nothing, using `shared_projects`. A view-only project opens with Save disabled.
- **Exports** (2D or 3D PNG) of a saved project add a row to `exports`. **AI assistant answers** for a saved project go into `ai_suggestions` (only answers from the real chat workflow, not the built-in canned ones).
- **Wall colours and flooring aren't saved yet.** They go to MongoDB in Task 3.3.
- **Who you are** comes from your session (see below). Every page and API route asks `lib/server/currentUser.ts`, and new projects belong to whoever saves them.

**Accounts and sessions**

Login is our own, using the `users` and `sessions` tables (no auth library), so all the SQL is visible in `lib/server/auth.ts` and `lib/server/currentUser.ts`.

- **Register** checks the input with zod (name 1–100 characters, a valid email, password 8–72 characters, matching confirmation), hashes the password with bcrypt (cost 10) and, in one transaction, inserts the user and a session. The email is stored lowercased; the `UNIQUE` constraint turns a taken email into a 409.
- **Log in** looks the user up by email and compares the password with bcrypt. An unknown email is still compared against a dummy hash, so the response time doesn't reveal which emails have accounts, and both cases say "Email or password is incorrect." Logging in also deletes that user's expired sessions.
- **The session cookie** `spacify_session` holds a random 32-byte token. It's `httpOnly` (JavaScript can't read it), `sameSite=lax` (not sent on cross-site form posts, so other sites can't log you out or act as you), `secure` in production, and expires with its session.
- **Every request** hashes the cookie's token and looks it up: `SELECT … FROM sessions s JOIN users u … WHERE s.token = $1 AND s.expires_at > now()`. A missing, forged or expired cookie finds nothing and counts as logged out: API routes answer 401 `{ "error": "Please log in." }` and pages redirect to `/login?next=<page>`, which brings you back afterwards (only to paths on this site).
- **`proxy.ts`** only checks that the cookie exists before `/projects` and `/design` (except `/design?demo=1`), to redirect early. The real check is always the database lookup above.
- **Log out** is a form `POST /api/auth/logout`: it deletes the session row and clears the cookie.

*Sessions, for the DBMS report.* `sessions.token` stores the **SHA-256 hash** (64 hex characters) of the token, never the token itself. The token is random, so a plain hash is enough (unlike passwords, it can't be guessed), and anyone who reads the table, from a backup or a leaked dump, can't turn a row back into a working cookie. Each session lasts 30 days: `expires_at = now() + 30 days` on insert, and `CHECK (expires_at > created_at)` keeps that consistent. Expiry is enforced in the lookup (`expires_at > now()`), not by the cookie, so an expired row stops working even if the browser still sends it. Expired rows are deleted when that user next logs in (or in bulk with Q13 in `db/queries.sql`). Deleting a user removes their sessions (`ON DELETE CASCADE`), and one user can have several sessions (one per browser/device).

**API**

| Method | Route | Needs | Does |
|---|---|---|---|
| POST | `/api/auth/register` | — | `{ name, email, password, confirmPassword }` → creates the account, logs in |
| POST | `/api/auth/login` | — | `{ email, password }` → sets the session cookie |
| POST | `/api/auth/logout` | — | Ends the session, redirects to `/` |
| GET | `/api/auth/me` | login | The logged-in user `{ id, name, email }` |
| GET | `/api/projects` | login | Projects you own or that are shared with you |
| POST | `/api/projects` | login | Create a project (owned by you) with its rooms |
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
  login/, register/     account pages
proxy.ts                sends visitors without a session cookie to /login
  api/
    sketch/route.ts     sketch image → Qwen (Ollama) or n8n → validated rooms (zod)
    chat/route.ts       AI assistant (n8n or fallback answers); logs to ai_suggestions
    auth/…              register, login, logout, me — users + sessions
    projects/…          list, create, load, save, delete, log exports — Postgres
    rooms/route.ts      list / add single rooms — Postgres
    design/route.ts     501 stub  — MongoDB (Task 3.3)
    ai/route.ts         501 stub  — ChromaDB (Task 3.4)
db/                     schema.sql, seed.sql, queries.sql, reset.sql
scripts/db-setup.mjs    npm run db:setup / db:reset
components/
  ThemeProvider.tsx, ThemeToggleButton.tsx, UserMenu.tsx (name → My projects / Log out)
  auth/                 AuthPage (frame), AuthForm (login + register form)
  landing/              Reveal (scroll fade-in), StartForm
  projects/ProjectCard  one saved project, with delete
  design/
    DesignStudio.tsx    owns all project + UI state
    ThreeCanvas.tsx     client-only wrapper around the Three.js scene
    RoomPanel.tsx       room list, add room, floors
    DesignPanel.tsx     wall colour, flooring, ceiling height
    CanvasOverlays.tsx  layer toggles, camera presets, zoom
    PlanView.tsx        2D plan editor (move/resize rooms, doors, windows) + PNG export
    ChatView.tsx        AI assistant
    UploadFlow.tsx      upload card + analysis overlay
    TutorialModal.tsx   sketch tutorial
    Topbar.tsx
lib/
  rooms.ts              Room and opening types, colours, defaults, walls, placement
  projects.ts           project types + zod validation shared by browser and API
  auth.ts               account validation (zod), safe ?next= redirects, cookie name
  scene/SpacifyScene.ts the Three.js scene (orbit, picking, walkthrough, export)
  plan.ts               2D plan drawing, hit testing and snapping
  browser.ts            image compression, downloads
  server/
    db.ts               pg connection pool, query(), withTransaction()
    projects.ts         all project/room SQL, with access checks
    auth.ts             register, login, logout: bcrypt + sessions SQL
    currentUser.ts      who's signed in: getCurrentUser(), getCurrentUserId(), requireUser()
    errors.ts           turns DB/validation errors into clear messages
    ollama.ts, sketch.ts, chat.ts, http.ts
```

React owns the state; `SpacifyScene` only draws it. `DesignStudio` passes rooms, floors, layers, per-room designs and the selection down to `<ThreeCanvas />`, which pushes them into the scene.

## The 2D plan editor (Floor Plan tab)

- **Move a room:** drag it. Its edges snap to other rooms' walls (a dashed guide shows the line), otherwise to a 0.5 ft grid. Arrow keys nudge the selected room by 0.5 ft (Shift: 5 ft).
- **Resize:** drag the handles on the selected room's corners and edges (4–40 ft per side). Doors and windows stay where they are; if a wall gets too short for one, it shrinks.
- **Doors and windows:** pick **+ Door** or **+ Window** and click a wall. A door swings into the room you clicked from. Drag one along its wall (or onto another wall of the same room), set its width in the bar at the top, or press Delete to remove it. A door on a wall two rooms share opens both walls in 3D.
- **View:** scroll or pinch to zoom, drag empty space to pan, **Fit** to see the whole floor. Rooms that overlap turn red.
- New rooms are placed against the east side of the floor's existing rooms; a sketch's rooms are packed in rows with walls touching. The 3D view uses the same positions.

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

Done: Task 1 (Next.js), Task 2 (sketch recognition with local Qwen), Task 3.1–3.2 (PostgreSQL, using plain SQL + `pg` rather than Prisma so the SQL stays visible), Task 4.1–4.3 (register, log in, log out, with our own sessions) and Task 4.4–4.5 (save and load projects).

Next: Task 3.3 MongoDB for wall colours and flooring → Task 3.4 ChromaDB → Task 5 RAG chat.
