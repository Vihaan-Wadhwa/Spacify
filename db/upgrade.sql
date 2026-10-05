-- Brings a database created before the 2D plan editor up to date.
-- npm run db:setup runs this automatically when the openings table is missing.

-- Same as table 9 in schema.sql.
CREATE TABLE openings (
  id           INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id      INT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  kind         VARCHAR(10)   NOT NULL CHECK (kind IN ('door', 'window')),
  wall         CHAR(1)       NOT NULL CHECK (wall IN ('n', 'e', 's', 'w')),
  wall_offset  NUMERIC(10,2) NOT NULL CHECK (wall_offset >= 0),
  width        NUMERIC(10,2) NOT NULL CHECK (width > 0 AND width <= 40)
);
CREATE INDEX idx_openings_room ON openings(room_id);

-- Existing rooms used to get a fixed door and window; store those so nothing disappears.
INSERT INTO openings (room_id, kind, wall, wall_offset, width)
SELECT r.id, o.kind, o.wall, o.wall_offset, o.width
  FROM rooms r
 CROSS JOIN LATERAL (VALUES
   ('door',   's', ROUND(LEAST(1, (r.width - LEAST(3, r.width / 2)) / 2), 1), LEAST(3, r.width / 2)),
   ('window', 'n', ROUND((r.width - LEAST(4, r.width / 2)) / 2, 1),          LEAST(4, r.width / 2))
 ) AS o(kind, wall, wall_offset, width)
 ORDER BY r.id;
