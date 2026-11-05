# Spacify

Browser-based 3D home design: upload a floor-plan sketch (or add rooms by hand), arrange it on a to-scale 2D plan (move and resize rooms, place doors and windows), see it as a realistic 3D house on its plot, walk through it like a game, design each room's interior (flooring, walls, windows, doors, furniture, modular kitchen), and ask the AI assistant for design ideas.

Next.js (App Router, TypeScript) + Three.js, with projects stored in PostgreSQL and each room's finishes in MongoDB.

## Run it

```bash
npm install
cp .env.example .env.local
docker compose up -d          # start PostgreSQL and MongoDB (or see "Database" and "Room designs" below for other ways)
npm run db:setup              # create the tables, the room_designs collection and sample data
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
- `/design?demo=1` — a sample 3BHK (drawing and dining rooms, kitchen, 3 bedrooms, 3 bathrooms, walk-in closet, pooja room, store, passage, balconies), open to everyone; saving asks you to log in. The same plan is the tutorial's example sketch and the landing-page preview (`lib/demoPlan.ts`)
- Rooms that aren't one of the built-in types (an office, gaming room, gym…) are **Other** rooms: pick "Other (name it)…" when adding a room, rename any room in its card, or write the room's name (or `O` / `O Office`) on a sketch

Without a database, the landing page and the demo still work; logging in and saving don't. Without MongoDB, projects still load and save, but wall finishes and flooring don't (the app says so).

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
- **Wall finishes, flooring and other room finishes** are saved in MongoDB with the same Save (see "Room designs" below).
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
| POST | `/api/projects` | login | Create a project (owned by you) with its rooms and their designs |
| GET | `/api/projects/:id` | view | The project and its rooms |
| PUT | `/api/projects/:id` | edit | Save name, floors and rooms (PostgreSQL), then their designs (MongoDB) |
| DELETE | `/api/projects/:id` | owner | Delete it (rooms, furniture, exports, suggestions, shares cascade), then its designs |
| POST | `/api/projects/:id/exports` | view | Log a `2d`/`3d` export |
| GET / POST | `/api/rooms` | view / edit | List rooms (`?projectId=`) or add one |
| GET | `/api/design?projectId=` | view | The project's room designs from MongoDB, keyed by room id |
| PUT | `/api/design` | edit | `{ projectId, roomId, design }` → upsert one room's design |
| POST | `/api/plans` | — | `{ homeType, bhk, floors, extras, width, depth, facing, setbacks, vastu }` → the best 3–5 laid-out plan options for the plot |

## Room designs (MongoDB)

Each room's finishes (wall finish and colour, flooring, and when chosen the ceiling, lighting and, for kitchens, the layout) are one document in the MongoDB collection `room_designs`, linked to PostgreSQL by id.

**Getting a MongoDB server** — pick one:

1. **Docker**: the same `docker compose up -d` starts `mongo:7` on port 27017 next to PostgreSQL (data in the `spacify-mongodata` volume). It matches the default `MONGODB_URI`.
2. **MongoDB Atlas free tier** (M0): create a cluster and a database user, allow your IP under Network Access, and paste the `mongodb+srv://…` connection string into `MONGODB_URI`.

Then `npm run db:setup` creates the collection with its validator and indexes and adds sample designs for the sample rooms (it looks their ids up in PostgreSQL). If MongoDB isn't set or isn't reachable, it says so and still sets up PostgreSQL; run it again later. `npm run db:reset` drops and recreates the collection too. To look inside: `docker compose exec mongo mongosh spacify`, then e.g. `db.room_designs.find()`.

| File | What it is |
|---|---|
| `db/mongo-validator.json` | The collection's `$jsonSchema` validator |
| `db/mongo-seed.json` | Sample designs (including a kitchen with a `kitchen` block) |
| `db/mongo-queries.js` | 5 queries for the report: rooms per flooring material, most common wall finish per room type, kitchens by layout, designs changed in the last 7 days, and a `room_id` lookup with `explain()`. Run: `docker compose exec -T mongo mongosh --quiet spacify --file /dev/stdin < db/mongo-queries.js` |
| `scripts/check-consistency.mjs` | `npm run db:check`: compares the two databases (see below) |

**The document**

```js
{
  _id: ObjectId("…"),
  room_id: 8,               // PostgreSQL rooms.id      (unique index)
  project_id: 2,            // PostgreSQL projects.id   (index: load or delete a whole project)
  room_type: "Kitchen",     // copy of rooms.room_type, so aggregations don't need PostgreSQL
  walls:    { finish: "tiles", color: "#f5ebe8" },                       // paint | tiles | marble | wallpaper | wood_panel
  flooring: { material: "granite", name: "Grey Granite", color: "#9e9e9e" }, // marble | vitrified | tiles | wood | granite
  ceiling:  { type: "pop" },                          // optional: plain | pop | gypsum | wood
  lighting: [{ type: "downlight", count: 6 }],        // optional
  kitchen:  { layout: "island", countertop: "Quartz" }, // optional, kitchens only: L | U | parallel | island | straight
  updated_by: 2,            // PostgreSQL users.id
  updated_at: ISODate("…")
}
```

The validator (`validationLevel: "strict"`, `validationAction: "error"`) is MongoDB's version of PostgreSQL's CHECK constraints. It requires the ids, `walls` and `flooring`; limits finishes, materials and layouts to the lists above; requires `#rrggbb` colours and integer ids; and rejects unknown fields. For example, inserting `walls.finish: "glass"` or leaving out `room_id` fails with *Document failed validation* (code 121). The app checks the same shape with zod first (`Design` in `lib/projects.ts`), so MongoDB rejecting something means it came from outside the app.

**Why designs live in MongoDB.** A room itself (size, position, project, who may see it) is relational and stays in PostgreSQL. Its finishes aren't the same shape from room to room: a kitchen has a layout and a countertop, a living room may have a false ceiling and several kinds of lighting, and a balcony only has walls and a floor. In SQL that means either nullable columns (`kitchen_layout` is NULL for every bedroom) or a table per optional part (`room_lighting`, `kitchen_details`, …) joined on every load. As a document, each room carries exactly the parts it has, the whole design is read and written as one unit, and a new kind of detail (say, bathroom fittings) needs no migration. The validator keeps that flexibility from turning into anything goes.

**How the two databases link**

- `room_id`, `project_id` and `updated_by` are PostgreSQL ids. There are no foreign keys across databases, so the app keeps them consistent.
- PostgreSQL stays the source of truth for which rooms exist and who may see them. Every MongoDB read or write (`lib/server/designs.ts`) first checks `project_access()` through PostgreSQL: view access to read, edit access to write. MongoDB never decides access. Reads only ask for rooms PostgreSQL still has.
- Opening `/design?project=<id>` loads the rooms from PostgreSQL, then their designs with `find({ project_id, room_id: { $in: … } })`. If MongoDB is down or not configured, the page still opens with default finishes and a message saying why.

**Saving: a cross-database write with eventual consistency.** One Save button, one request (`PUT /api/projects/:id` with `designs` keyed by the browser's room ids), two steps:

1. The PostgreSQL transaction (rooms, doors, windows) commits and returns `idMap`: browser room id → database room id. A room added since the last save gets its id here, so a room designed before its first save is stored under its new id.
2. One ordered MongoDB `bulkWrite`: an upsert (`replaceOne` with `upsert: true`, keyed by `room_id`) for each designed room, then `deleteMany({ project_id, room_id: { $nin: <the project's room ids> } })` to remove the designs of deleted rooms.

No transaction spans both databases (that would need two-phase commit). If step 2 fails, for example because MongoDB is down, step 1 isn't undone: the response carries `warning: "Rooms saved, but finishes couldn't be saved: …"`, the page shows it and stays marked unsaved, and the next Save sends everything again. Step 2 is upserts plus delete-by-difference, so repeating it is safe. The databases can be briefly out of step, and they catch up on the next successful save.

Deleting a project deletes it in PostgreSQL (rooms cascade), then runs `deleteMany({ project_id })` in MongoDB. If that second step fails, the documents are left as **orphans**. The app never shows them (it only reads designs of rooms PostgreSQL has). `npm run db:check` lists them, and `npm run db:check -- --fix` deletes them. It also lists rooms with no design yet, which is normal.

## Sketch recognition with Gemini (default)

Sketches are read by Google's **Gemini API** (vision). Create an API key at [Google AI Studio](https://aistudio.google.com/apikey), put it in `.env.local` as `GEMINI_API_KEY=…` and restart `npm run dev`. The key is only used on the server.

Then upload a sketch at `/design`. If something's wrong, the upload screen says what: no key, a rejected key, the rate limit, or no rooms found.

| Env var | Default | Notes |
|---|---|---|
| `DATABASE_URL` | — | PostgreSQL connection string |
| `MONGODB_URI` | — | MongoDB connection string (room designs) |
| `MONGODB_DB` | `spacify` | MongoDB database name |
| `SKETCH_PROVIDER` | `gemini` | `gemini` or `n8n` (hosted workflow); any other value means Gemini |
| `GEMINI_API_KEY` | — | needed to read sketches |
| `GEMINI_VISION_MODEL` | `gemini-3.5-flash` | any Gemini model that takes images (asked for minimal thinking, which makes reading a sketch about 10 s) |
| `N8N_SKETCH_WEBHOOK_URL` | — | only used when `SKETCH_PROVIDER=n8n` |
| `N8N_CHAT_WEBHOOK_URL` | — | AI assistant; without it, built-in canned answers |
| `OLLAMA_URL` | `http://localhost:11434` | local Ollama for the `/start` plan suggestions (optional) |
| `OLLAMA_PLAN_MODEL` | `qwen2.5:3b` | text model that suggests plan arrangements on `/start` (optional) |
| `PLAN_AI_TIMEOUT_MS` | `120000` | how long `/start` waits for those suggestions |

All of these are read on the server only. How it works: `lib/server/gemini.ts` sends the image with a prompt and a response schema (Gemini's structured output), so the model can only answer in the `{ rooms: [...] }` shape. For each room the model gives its name, any dimensions written in it, and where it is on the image: the centre of its label and the box around its walls, in Gemini's own `[y, x]` / `box_2d` format scaled to 0–1000. The browser sends the image's pixel size with it, and those coordinates are turned back into pixels (so a wide sketch isn't stretched). `lib/server/sketch.ts` validates and clamps every room with zod, then `lib/server/sketchLayout.ts` turns pixels into a floor plan in feet:

- **Scale** comes from rooms with written dimensions (feet per pixel). Sketches aren't drawn to scale, so written dimensions always win over drawn sizes; a room without them is sized from its drawn box, or a typical size for its type.
- **Arrangement** comes mainly from label positions, which the model reads more reliably than wall outlines. A box is only used if it contains its own label and no other room's. For each pair of rooms, the sketch decides whether they sit side by side or one above the other.
- **Walls meet:** rooms are pushed together so neighbours share a wall (gaps under 3 ft count as sketching error; a bigger one, like a courtyard, is kept), rooms stacked in a column line up, and nothing overlaps. Each floor starts at 0,0.

If the model gives no positions (the n8n workflow, or an older model), rooms are packed in rows as before. Either way you can fine-tune the result in the Floor Plan tab.

## Plan options on /start (free, runs locally)

`/start` asks for the home (type, BHK, extra rooms), the plot (width along the road, depth, which side the road is on, floors, setbacks, Vastu) and, optionally, anything else in the visitor's own words ("my parents can't climb stairs, we have a car"). It shows the best 3–5 layouts.

- `lib/planRules.ts` is the rulebook: what makes an Indian home plan good or bad, as checks on a drawn plan. Hard rules (never two bathrooms side by side, no bathroom against the kitchen or pooja room, every bedroom reachable without walking through another, the living room at the road, no long thin rooms, balconies on an outside wall) and soft ones (kitchen beside dining, attached bathrooms, daylight, quiet bedrooms, plumbing stacked between floors).
- `lib/planner.ts` does the drawing, with no AI and no network. An arrangement says which rooms go in which band across the plot, front to back, and how people move through it (a passage across, a corridor down one side, or neither). Each band is laid by search: rooms are grouped into columns (a bedroom with its bathroom tucked into one end beside a dressing area, the kitchen with its store), every grouping is drawn and checked against the rulebook, and the cleanest wins. Rooms never overlap and always fit the plot; on big plots they grow and the house takes only the land it needs. Each layout is scored, and a hard rule break costs a sixth of the score.
- `lib/planNotes.ts` reads the visitor's words into wishes (ground-floor bedroom for elders, open kitchen, parking, study, big hall, quiet bedrooms, kitchen by the entrance, attached bathrooms, utility, Vastu or not), including common Hindi and South Indian words, and lists what can't be drawn (a pool, a lift). Wishes add rooms (parking, utility, study, bathrooms) and count in the score.
- `lib/server/planAi.ts` adds a local model's ideas when Ollama is running. A 3B model is kept on rails: it reads a written guide (`lib/server/skills/floor-planning.md`, the same rulebook plus a plot-shape playbook, edge cases and good/bad examples); it only decides front/middle/back per room plus circulation and mirroring (its answer's schema has one slot per room, so it can't skip or invent one), with the code ordering rooms inside a band; it writes four reasoning lines first; the code hands it the facts (plot shape, band capacity, which corner is which); each idea is drawn, checked, and sent back once with its rule breaks and a concrete fix. Its ideas compete with the rule templates on the same score. Without Ollama the rule-based options still come back.

```bash
ollama pull qwen2.5:3b   # ~2 GB; fine on 8 GB RAM. qwen2.5:7b suggests better layouts with 16 GB.
npm run ai:setup         # optional: bakes the guide into a "spacify-planner" model (then OLLAMA_PLAN_MODEL=spacify-planner)
```

Test benches (run them after changing the rules, the planner, the guide or the prompts):

```bash
npm run plans:eval                 # 25 briefs (flats, houses, villas, narrow, shallow, tiny, G+2, notes): hard faults in the top plan
npm run plans:eval -- --ai         # the same with the local model: its ideas' faults before and after review, timing
npm run plans:eval -- --draw out   # writes every option as an SVG sheet to look at
npm run notes:eval -- --ai         # how well people's own words are read, by keywords and by the model
npm run notes:eval -- --held-out --ai   # sentences never used for tuning
```

Picking an option and pressing **Continue with this plan** opens the studio with those rooms (after logging in if needed); nothing is saved until **Save**.

## Project structure

```
app/
  layout.tsx            fonts (self-hosted DM Sans / DM Serif Display), theme
  globals.css           design tokens (dark + light)
  page.tsx, landing.css landing page
  design/page.tsx       design page; loads ?project=<id> from Postgres (+ its designs from MongoDB) on the server
  design/studio.css     design-page styles (scoped under .studio)
  projects/page.tsx     "My projects" list (+ projects.css)
  login/, register/     account pages
proxy.ts                sends visitors without a session cookie to /login
  api/
    sketch/route.ts     sketch image → Gemini or n8n → validated rooms (zod)
    chat/route.ts       AI assistant (n8n or fallback answers); logs to ai_suggestions
    auth/…              register, login, logout, me — users + sessions
    projects/…          list, create, load, save, delete, log exports — Postgres
    rooms/route.ts      list / add single rooms — Postgres
    design/route.ts     room designs by project / single room — MongoDB
    ai/route.ts         501 stub  — ChromaDB (Task 3.4)
db/                     schema.sql, seed.sql, queries.sql, reset.sql, upgrade*.sql; mongo-validator.json, mongo-seed.json, mongo-queries.js
scripts/db-setup.mjs    npm run db:setup / db:reset (PostgreSQL + MongoDB)
scripts/check-consistency.mjs  npm run db:check: orphaned designs, rooms without one
components/
  ThemeProvider.tsx, ThemeToggleButton.tsx, UserMenu.tsx (name → My projects / Log out)
  PlanSketch.tsx        the sample 3BHK as an SVG (tutorial example sketch, landing preview)
  auth/                 AuthPage (frame), AuthForm (login + register form)
  landing/              Reveal (scroll fade-in), StartForm
  projects/ProjectCard  one saved project, with delete
  design/
    DesignStudio.tsx    owns all project + UI state
    ThreeCanvas.tsx     client-only wrapper around the Three.js scene
    Topbar.tsx          Floor Plan / Interior Design / Architecture, AI assistant, save
    RoomPanel.tsx       Floor Plan: room list, add room, floors
    RoomList.tsx        Interior Design: pick a room
    InteriorPanel.tsx   Interior Design: flooring, walls, windows, doors, furniture, kitchen
    ColorWheel.tsx      paint colour wheel + hex code
    ShapeModal.tsx      draw or photograph a room's outline
    ArchitectureView.tsx  "coming soon"
    CanvasOverlays.tsx  floors to show, layer toggles, camera presets, zoom
    PlanView.tsx        2D plan editor (move/resize rooms, doors, windows) + PNG export
    ChatView.tsx        AI assistant
    UploadFlow.tsx      upload card + analysis overlay
    TutorialModal.tsx   sketch tutorial
lib/
  rooms.ts              Room, opening and design types, colours, defaults, walls, placement
  demoPlan.ts           the sample 3BHK: rooms, doors and windows, sketch labels
  projects.ts           project types + zod validation shared by browser and API
  auth.ts               account validation (zod), safe ?next= redirects, cookie name
  furniture.ts          where furniture goes in a room (free spots, typical sets), shared by panel and 3D
  floors.ts             where rooms go on upper floors; the staircase a new floor gets
  shape.ts              straightening a drawn outline into right-angled walls; finding the outline on a photo
  scene/
    SpacifyScene.ts     renderer, post-processing, orbit camera, picking, furniture dragging, walkthrough
    house.ts            one room in 3D: walls, exterior skin, doors, windows, stairs, ceiling, roof, collisions
    fittings.ts         furniture models, modular kitchen, bathroom fixtures
    world.ts            sky, sun, lawn, compound wall, gate, road, trees
    materials.ts, textures.ts  PBR materials; procedural colour/roughness/normal textures
    build.ts            boxes with world-scale UVs, merged per material
  plan.ts               2D plan drawing, hit testing and snapping
  browser.ts            image compression, downloads
  server/
    db.ts               pg connection pool, query(), withTransaction()
    projects.ts         all project/room SQL, with access checks
    mongo.ts            MongoDB client, getDb(), connection/validation error checks
    designs.ts          room_designs reads and writes, each after an access check in Postgres
    auth.ts             register, login, logout: bcrypt + sessions SQL
    currentUser.ts      who's signed in: getCurrentUser(), getCurrentUserId(), requireUser()
    errors.ts           turns DB/validation errors into clear messages
    gemini.ts, sketch.ts  sketch → rooms (Gemini, validation); sketchLayout.ts places them
    chat.ts, http.ts
```

React owns the state; `SpacifyScene` only draws it. `DesignStudio` passes rooms, floors, layers, per-room designs and the selection down to `<ThreeCanvas />`, which pushes them into the scene.

## The design page: three panels

- **Floor Plan** — everything about the plan itself, with a **2D plan / 3D view / Walkthrough** switch. The room list on the left edits names, sizes and floors.
  - **Adding a floor** adds a small staircase (8×10 ft) on the ground floor, in the spot that tucks best against the house and opens onto a passage or living area, and one directly above it on each new floor. New rooms go on the floor picked next to **+ Add room**; on an upper floor they're placed over the floor below, against the rooms already there.
  - **Room shapes:** each room card has a **Shape** row. Rectangle by default; **Draw or upload…** opens a pad where you draw the outline with the mouse or a finger, or upload a photo of one drawn on paper. The rough line is straightened like a notes app does (each stretch becomes a straight wall running across or down, near-equal walls line up, corners are squared, and anything that crosses itself is refused), shown over your drawing with each wall's length, then fitted to the room's overall width × length on the half-foot grid. Shapes have right-angled corners (L, T, U, notched rooms); staircases stay rectangular. Doors and windows move to the matching walls of the new shape, and resizing the room stretches its shape. Photos are read in the browser (`lib/shape.ts`): dark pen lines are picked out against the paper's local brightness, small gaps closed, and the biggest enclosed area traced.
  - **Open walls:** **+ Opening** puts a gap with no door in any wall (a passage or archway, with a lintel above). **Remove wall** takes out the whole wall two rooms share: they become one space (an L-shaped kitchen from Kitchen + Store, say), with no wall in 3D, and Interior Design gives them the same floor, walls, windows and doors. Select the gap and use **Put wall back** to undo it. Rooms are still rectangles underneath; an open gap is stored as an opening of kind `open` (`db/upgrade-open.sql`, applied by `npm run db:setup`).
  - **Double doors:** a door 5 ft or wider is a pair of leaves, drawn as two doors meeting in the middle. Select one leaf and press Delete to make it a single door.
  - **Furniture** shows on the 2D plan too (the **Furniture** toggle hides it): drag a piece to move it, R to rotate, Delete to remove.
- **Interior Design** — pick a room (from the list or by clicking it in 3D; the camera swings to it), or **Entire home** to set the flooring and walls of every room at once, then:
  - **Flooring:** wood, tiles or marble, four colours each.
  - **Walls:** paint (15 shades, plus a colour wheel with a hex code field), marble (4) or wallpaper (6 designs).
  - **Windows:** sliding, opening like a door (casement), fixed glass, or sliding with an insect mesh; aluminium (5 colours) or wood (5 woods, with matte / satin / high-gloss polish).
  - **Doors:** plain flush, panelled, grooved lines or glass inset; 5 woods; 3 polishes. They apply to every door of the room on the face that looks into it, so a door between two rooms can be panelled on one side and glass-inset on the other. Windows apply to the room's own windows.
  - **Furniture:** single bed, small double, queen and king beds, bedside table, cupboard, dressing table, study table, TV panel, sofa and dining table, or "a typical set for this room". Each piece finds a free spot against a wall, clear of doors; drag it in 3D to move it, R to rotate, Delete to remove. Everything is a basic brown for now. **Hide furniture in every room** shows the bare structure, with **Keep basic cupboards** inside it.
  - **Kitchen:** a **Modular kitchen** switch fills the kitchen with an L of base and wall cabinets, granite counter and tiled backsplash, sink (under a window if there is one), gas stove with chimney, fridge, pantry and an oven/microwave unit, fitted around the doors. Designing it is for later.
- **Architecture** — coming soon.
- The **✦** button opens the AI assistant over any panel.

Designs (including furniture, windows and doors) are saved to MongoDB with the room. After pulling this version into an existing setup, run `npm run db:setup` once so the `room_designs` validator accepts the new fields.

## The 3D model

Rendered with physically based materials and tone mapping, sun shadows, image-based light from a soft sky, ambient occlusion and 4× anti-aliasing; it only redraws when something changes. Every wall is real: each room's plastered wall sits inside its footprint with the room's finish on its face, outside walls get a 9-inch exterior skin on a stone plinth, and doors and windows are full units (frames, sashes, glass, sills, sunshades outside). Textures (wood planks, tiles, marble, wallpaper, plaster, grass…) are generated in the browser at real-world scale, so any colour works and nothing is downloaded. The house stands on its plot: lawn, compound wall with a gate, driveway, footpath, road and trees. There are no floating labels; hover a room to see its name.

- **Orbit:** drag to turn, right-drag or Shift-drag to pan, scroll to zoom. **Roof** puts the roof and ceilings on; with more than one floor, pick a floor to look down into it.
- **Walkthrough:** WASD and the mouse at eye height, Shift to run. Walls and furniture are solid, doors swing open as you reach them, the stairs (a dog-leg stair in each Staircase room) take you up to the next floor, and indoors the room's ceiling light comes on while your eyes adjust. If the frame rate drops, it turns ambient occlusion off, then lowers the resolution.

## The 2D plan editor (Floor Plan tab)

- **Move a room:** drag it. Its edges snap to other rooms' walls (a dashed guide shows the line), otherwise to a 0.5 ft grid. Arrow keys nudge the selected room by 0.5 ft (Shift: 5 ft).
- **Resize:** drag the handles on the selected room's corners and edges (4–40 ft per side). Doors and windows stay where they are; if a wall gets too short for one, it shrinks.
- **Doors, windows and openings:** pick **+ Door**, **+ Window** or **+ Opening** and click a wall (or **Remove wall** and click a wall between two rooms). A selected one shows a dot at each end: drag a dot to resize it. Windows (up to 16 ft) and openings stretch freely; doors snap between the two door sizes, a 3 ft single and a 5 ft double (two 2.5 ft leaves), which the bar at the top also switches. A door swings into the room you clicked from. Drag one along its wall (or onto another wall of the same room), type a window's or opening's width in the bar at the top, or press Delete to remove it. A door on a wall two rooms share opens both walls in 3D.
- **View:** scroll or pinch to zoom, drag empty space to pan, **Fit** to see the whole floor. Rooms that overlap turn red.
- New ground-floor rooms are placed against the east side of the floor's existing rooms (upper floors: see above); a sketch's rooms are packed in rows with walls touching. The 3D view uses the same positions.

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

Done: Task 1 (Next.js), Task 2 (sketch recognition, now with the Gemini API), Task 3.1–3.2 (PostgreSQL, using plain SQL + `pg` rather than Prisma so the SQL stays visible), Task 3.3 (room designs in MongoDB, with the official driver and a `$jsonSchema` validator rather than Mongoose), Task 4.1–4.3 (register, log in, log out, with our own sessions) and Task 4.4–4.5 (save and load projects).

Next: Task 3.4 ChromaDB → Task 5 RAG chat.
