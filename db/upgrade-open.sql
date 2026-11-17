-- Lets openings be 'open' (a gap with no door: a doorless passage, or a removed wall between two rooms).
-- npm run db:setup runs this automatically on databases whose openings table only allows doors and windows.
ALTER TABLE openings DROP CONSTRAINT IF EXISTS openings_kind_check;
ALTER TABLE openings ADD CONSTRAINT openings_kind_check CHECK (kind IN ('door', 'window', 'open'));
