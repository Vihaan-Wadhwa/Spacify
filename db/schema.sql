-- ════════════════════════════════════════════════════════════════════
--  Spacify — PostgreSQL schema
--  8 tables from the DBMS report (+ openings for doors and windows), plus: indexes on every foreign key,
--  CHECK constraints on all dimensions, and triggers that keep derived
--  data (total_area, updated_at) correct.
--  Units: all room/furniture dimensions and positions are in feet.
--  Run with:  npm run db:setup   (or psql -f db/schema.sql)
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. users ────────────────────────────────────────────────────────
CREATE TABLE users (
  id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        VARCHAR(100) NOT NULL CHECK (length(trim(name)) > 0),
  email       VARCHAR(255) NOT NULL UNIQUE
              CHECK (email = lower(email) AND email LIKE '%_@_%'),
  password    VARCHAR(255) NOT NULL,              -- bcrypt hash, never plain text
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ─── 2. projects ─────────────────────────────────────────────────────
CREATE TABLE projects (
  id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(100)  NOT NULL CHECK (length(trim(name)) > 0),
  floors      INT           NOT NULL DEFAULT 1 CHECK (floors BETWEEN 1 AND 3),
  -- Derived attribute: kept equal to SUM(width * length) of the project's rooms
  -- by trg_rooms_total_area below. Stored (not computed on read) so project
  -- lists don't need a join — deliberate denormalisation, maintained by trigger.
  total_area  NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (total_area >= 0),
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_projects_user ON projects(user_id);

-- ─── 3. rooms ────────────────────────────────────────────────────────
CREATE TABLE rooms (
  id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id  INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  room_type   VARCHAR(50)   NOT NULL CHECK (length(trim(room_type)) > 0),
  width       NUMERIC(10,2) NOT NULL CHECK (width  > 0 AND width  <= 100),
  length      NUMERIC(10,2) NOT NULL CHECK (length > 0 AND length <= 100),
  height      NUMERIC(10,2) NOT NULL DEFAULT 10 CHECK (height BETWEEN 7 AND 20),
  floor       INT           NOT NULL DEFAULT 1  CHECK (floor BETWEEN 1 AND 3),
  position_x  NUMERIC(10,2) NOT NULL DEFAULT 0,   -- north-west corner on the 2D plan (x east, z south)
  position_z  NUMERIC(10,2) NOT NULL DEFAULT 0
);
CREATE INDEX idx_rooms_project ON rooms(project_id);

-- ─── 4. furniture ────────────────────────────────────────────────────
CREATE TABLE furniture (
  id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id     INT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  type        VARCHAR(20)   NOT NULL
              CHECK (type IN ('sofa', 'bed', 'table', 'chair', 'wardrobe', 'desk')),
  name        VARCHAR(100)  NOT NULL,
  width       NUMERIC(10,2) NOT NULL CHECK (width  > 0),
  length      NUMERIC(10,2) NOT NULL CHECK (length > 0),
  height      NUMERIC(10,2) NOT NULL CHECK (height > 0),
  position_x  NUMERIC(10,2) NOT NULL,             -- relative to the room's corner
  position_y  NUMERIC(10,2) NOT NULL DEFAULT 0,
  position_z  NUMERIC(10,2) NOT NULL,
  rotation_y  NUMERIC(10,2) NOT NULL DEFAULT 0,   -- degrees
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_furniture_room ON furniture(room_id);

-- ─── 5. exports ──────────────────────────────────────────────────────
CREATE TABLE exports (
  id           INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id   INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id      INT NOT NULL REFERENCES users(id)    ON DELETE CASCADE,  -- who exported
  type         VARCHAR(10) NOT NULL CHECK (type IN ('2d', '3d')),
  exported_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_exports_project ON exports(project_id);

-- ─── 6. sessions ─────────────────────────────────────────────────────
-- Custom session store (login cookie holds `token`). Used by Task 4.
CREATE TABLE sessions (
  id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       VARCHAR(255) NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ  NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- ─── 7. ai_suggestions ───────────────────────────────────────────────
CREATE TABLE ai_suggestions (
  id           INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id   INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id      INT NOT NULL REFERENCES users(id)    ON DELETE CASCADE,  -- who asked
  user_prompt  TEXT NOT NULL,
  ai_response  TEXT NOT NULL,
  chroma_id    VARCHAR(64) UNIQUE,   -- id of this suggestion's vector in ChromaDB (Task 5)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_suggestions_project ON ai_suggestions(project_id);

-- ─── 8. shared_projects (M:N between users and projects) ─────────────
CREATE TABLE shared_projects (
  id           INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id   INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  shared_with  INT NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  permission   VARCHAR(10) NOT NULL CHECK (permission IN ('view', 'edit')),
  shared_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, shared_with)   -- one permission per user per project
);
CREATE INDEX idx_shared_projects_user ON shared_projects(shared_with);

-- ─── 9. openings (doors and windows in a room's walls) ───────────────
-- Not in the original report: added with the 2D plan editor. db/upgrade.sql adds it to older databases.
CREATE TABLE openings (
  id           INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id      INT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  kind         VARCHAR(10)   NOT NULL CHECK (kind IN ('door', 'window')),
  wall         CHAR(1)       NOT NULL CHECK (wall IN ('n', 'e', 's', 'w')),
  wall_offset  NUMERIC(10,2) NOT NULL CHECK (wall_offset >= 0),  -- from the wall's west/north end to the opening
  width        NUMERIC(10,2) NOT NULL CHECK (width > 0 AND width <= 40)
);
CREATE INDEX idx_openings_room ON openings(room_id);


-- ════════════════════════════════════════════════════════════════════
--  Triggers
-- ════════════════════════════════════════════════════════════════════

-- T1. projects.updated_at is bumped on every update of the project row.
CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_projects_updated_at
BEFORE UPDATE ON projects
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- T2. projects.total_area = SUM(width × length) of its rooms, recomputed
--     whenever a room is inserted, resized, moved to another project or deleted.
--     (The UPDATE on projects also fires T1, so updated_at moves too.)
CREATE FUNCTION refresh_total_area() RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    UPDATE projects
       SET total_area = (SELECT COALESCE(SUM(width * length), 0) FROM rooms WHERE project_id = OLD.project_id)
     WHERE id = OLD.project_id;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND (TG_OP = 'INSERT' OR NEW.project_id IS DISTINCT FROM OLD.project_id) THEN
    UPDATE projects
       SET total_area = (SELECT COALESCE(SUM(width * length), 0) FROM rooms WHERE project_id = NEW.project_id)
     WHERE id = NEW.project_id;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_rooms_total_area
AFTER INSERT OR UPDATE OF width, length, project_id OR DELETE ON rooms
FOR EACH ROW EXECUTE FUNCTION refresh_total_area();

-- T3. A project can't be shared with its own owner.
CREATE FUNCTION prevent_self_share() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND user_id = NEW.shared_with) THEN
    RAISE EXCEPTION 'Project % is owned by user %; it cannot be shared with its owner', NEW.project_id, NEW.shared_with
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_shared_projects_not_owner
BEFORE INSERT OR UPDATE ON shared_projects
FOR EACH ROW EXECUTE FUNCTION prevent_self_share();


-- ════════════════════════════════════════════════════════════════════
--  Access control function + summary view (used by the API)
-- ════════════════════════════════════════════════════════════════════

-- Returns 'owner', 'edit', 'view' or NULL (no access) for a user on a project.
CREATE FUNCTION project_access(p_user_id INT, p_project_id INT) RETURNS TEXT AS $$
  SELECT CASE
           WHEN p.user_id = p_user_id THEN 'owner'
           ELSE (SELECT s.permission FROM shared_projects s
                  WHERE s.project_id = p.id AND s.shared_with = p_user_id)
         END
    FROM projects p
   WHERE p.id = p_project_id;
$$ LANGUAGE sql STABLE;

-- One row per project with its owner and room count — what the projects page lists.
CREATE VIEW project_summary AS
SELECT p.id,
       p.name,
       p.user_id      AS owner_id,
       u.name         AS owner_name,
       p.floors,
       p.total_area,
       COUNT(r.id)    AS room_count,
       p.created_at,
       p.updated_at
  FROM projects p
  JOIN users u      ON u.id = p.user_id
  LEFT JOIN rooms r ON r.project_id = p.id
 GROUP BY p.id, u.name;
