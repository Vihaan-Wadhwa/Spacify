-- Lets rooms be other shapes than rectangles (L, T, U… — every corner a right angle).
-- npm run db:setup runs this automatically on databases whose rooms table has no shape column.
--
-- rooms.shape: the room's corners, clockwise, as [x, z] fractions (0–1) of its width and length; NULL for a rectangle.
-- rooms.area:  its real floor area when it has a shape (width × length would count the missing corner).
-- A shaped room's walls are numbered, so openings.wall is 'n'/'e'/'s'/'w' for rectangles or '0', '1', … otherwise.
ALTER TABLE rooms ADD COLUMN shape JSONB;
ALTER TABLE rooms ADD COLUMN area NUMERIC(10,2) CHECK (area > 0);
ALTER TABLE openings DROP CONSTRAINT IF EXISTS openings_wall_check;
ALTER TABLE openings ALTER COLUMN wall TYPE VARCHAR(2);
ALTER TABLE openings ADD CONSTRAINT openings_wall_check CHECK (wall ~ '^([nesw]|[0-9]{1,2})$');

-- total_area counts a shaped room's real area.
CREATE OR REPLACE FUNCTION refresh_total_area() RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    UPDATE projects
       SET total_area = (SELECT COALESCE(SUM(COALESCE(area, width * length)), 0) FROM rooms WHERE project_id = OLD.project_id)
     WHERE id = OLD.project_id;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND (TG_OP = 'INSERT' OR NEW.project_id IS DISTINCT FROM OLD.project_id) THEN
    UPDATE projects
       SET total_area = (SELECT COALESCE(SUM(COALESCE(area, width * length)), 0) FROM rooms WHERE project_id = NEW.project_id)
     WHERE id = NEW.project_id;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rooms_total_area ON rooms;
CREATE TRIGGER trg_rooms_total_area
AFTER INSERT OR UPDATE OF width, length, area, project_id OR DELETE ON rooms
FOR EACH ROW EXECUTE FUNCTION refresh_total_area();
