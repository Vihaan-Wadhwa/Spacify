-- ════════════════════════════════════════════════════════════════════
--  Spacify — sample data
--  Two users, a project each, one project shared between them (M:N),
--  plus furniture, exports and AI suggestions so every table has rows.
--
--  Test log-ins:  demo@spacify.in / spacify123
--                 rahul@example.com / rahul123
--  (No sessions are seeded: logging in creates them.)
-- ════════════════════════════════════════════════════════════════════

INSERT INTO users (name, email, password) VALUES
  ('Demo User',    'demo@spacify.in',   '$2b$10$wXrqG6YhtSeuLZGoh5PwWuGUKWHDXslALyEpXeCi/KPS0SmmaghgC'),
  ('Rahul Sharma', 'rahul@example.com', '$2b$10$uAXW5wN0Vg/h3GlAQXZM6exx34Afrda04.uHx1xUQZbDfU7Z3E9lO');

INSERT INTO projects (user_id, name, floors) VALUES
  ((SELECT id FROM users WHERE email = 'demo@spacify.in'),   'Sample 2BHK',     1),
  ((SELECT id FROM users WHERE email = 'rahul@example.com'), 'Rahul''s Villa',  2);

-- total_area is filled in automatically by trg_rooms_total_area as these rows go in.
-- position_x / position_z place each room on the 2D plan in feet; rooms that touch share a wall.
-- (A join doesn't keep the VALUES order, so the ORDER BY at the end fixes the order ids are handed out.)
INSERT INTO rooms (project_id, room_type, width, length, height, floor, position_x, position_z)
SELECT p.id, v.room_type, v.width, v.length, v.height, v.floor, v.px, v.pz
  FROM projects p
  JOIN (VALUES
    ( 1, 'Sample 2BHK',    'Living Room',    18, 14, 10, 1,  0.0,  0.0),
    ( 2, 'Sample 2BHK',    'Master Bedroom', 14, 13, 10, 1,  0.0, 14.0),
    ( 3, 'Sample 2BHK',    'Kitchen',        12, 10, 10, 1, 32.0,  0.0),
    ( 4, 'Sample 2BHK',    'Bedroom 2',      12, 12, 10, 1, 22.0, 14.0),
    ( 5, 'Sample 2BHK',    'Bathroom',        8,  6, 10, 1, 14.0, 14.0),
    ( 6, 'Sample 2BHK',    'Dining Room',    14, 12, 10, 1, 18.0,  0.0),
    ( 7, 'Rahul''s Villa', 'Living Room',    20, 16, 11, 1,  0.0,  0.0),
    ( 8, 'Rahul''s Villa', 'Kitchen',        12, 10, 10, 1, 20.0,  0.0),
    ( 9, 'Rahul''s Villa', 'Dining Room',    14, 12, 10, 1, 20.0, 10.0),
    (10, 'Rahul''s Villa', 'Staircase',       8,  8, 10, 1, 32.0,  0.0),
    (11, 'Rahul''s Villa', 'Master Bedroom', 16, 14, 10, 2,  0.0,  0.0),
    (12, 'Rahul''s Villa', 'Bedroom 2',      12, 12, 10, 2, 16.0,  0.0),
    (13, 'Rahul''s Villa', 'Bathroom',        8,  6, 10, 2, 28.0,  0.0),
    (14, 'Rahul''s Villa', 'Balcony',        10,  5, 10, 2,  0.0, 14.0)
  ) AS v(n, project, room_type, width, length, height, floor, px, pz) ON v.project = p.name
 ORDER BY v.n;  -- identity ids follow this order, which is the order rooms are listed in the app

-- Every room gets the editor's default door (south wall, near the west end) and window (centred on the north wall).
INSERT INTO openings (room_id, kind, wall, wall_offset, width)
SELECT r.id, o.kind, o.wall, o.wall_offset, o.width
  FROM rooms r
 CROSS JOIN LATERAL (VALUES
   ('door',   's', ROUND(LEAST(1, (r.width - LEAST(3, r.width / 2)) / 2), 1), LEAST(3, r.width / 2)),
   ('window', 'n', ROUND((r.width - LEAST(4, r.width / 2)) / 2, 1),          LEAST(4, r.width / 2))
 ) AS o(kind, wall, wall_offset, width)
 ORDER BY r.id;

INSERT INTO furniture (room_id, type, name, width, length, height, position_x, position_z, rotation_y)
SELECT r.id, v.type, v.name, v.w, v.l, v.h, v.px, v.pz, v.rot
  FROM rooms r
  JOIN projects p ON p.id = r.project_id
  JOIN (VALUES
    ('Sample 2BHK',    'Master Bedroom', 'bed',      'King bed',          6.5, 7.0, 1.5, 4.0,  3.0,   0),
    ('Sample 2BHK',    'Master Bedroom', 'wardrobe', '3-door wardrobe',   6.0, 2.0, 7.0, 8.0, 11.0,   0),
    ('Sample 2BHK',    'Living Room',    'sofa',     'L-shaped sofa',     8.0, 3.0, 2.8, 5.0, 10.0,   0),
    ('Sample 2BHK',    'Living Room',    'table',    'Coffee table',      3.5, 2.0, 1.3, 7.0,  6.0,   0),
    ('Sample 2BHK',    'Bedroom 2',      'desk',     'Study desk',        4.0, 2.0, 2.5, 1.0,  1.0,  90),
    ('Sample 2BHK',    'Bedroom 2',      'chair',    'Desk chair',        1.8, 1.8, 3.0, 2.5,  3.0,   0),
    ('Rahul''s Villa', 'Dining Room',    'table',    '6-seater table',    6.0, 3.0, 2.5, 4.0,  4.5,   0),
    ('Rahul''s Villa', 'Master Bedroom', 'bed',      'King bed',          6.5, 7.0, 1.5, 5.0,  3.0,   0)
  ) AS v(project, room_type, type, name, w, l, h, px, pz, rot)
    ON v.project = p.name AND v.room_type = r.room_type;

-- M:N — Rahul shares his villa with the demo user, who can edit it.
INSERT INTO shared_projects (project_id, shared_with, permission)
VALUES ((SELECT id FROM projects WHERE name = 'Rahul''s Villa'),
        (SELECT id FROM users WHERE email = 'demo@spacify.in'), 'edit');

INSERT INTO exports (project_id, user_id, type)
SELECT p.id, p.user_id, t.type
  FROM projects p CROSS JOIN (VALUES ('2d'), ('3d')) AS t(type)
 WHERE p.name = 'Sample 2BHK';

INSERT INTO ai_suggestions (project_id, user_id, user_prompt, ai_response)
SELECT p.id, p.user_id, v.prompt, v.response
  FROM projects p
  JOIN (VALUES
    ('Sample 2BHK', 'Vastu tips for master bedroom',
     'Place the master bedroom in the South-West. Keep the bed''s head towards the South or East, and avoid a beam directly above the bed.'),
    ('Sample 2BHK', 'Marble vs vitrified tiles',
     'Marble for living and dining areas, double-charged vitrified tiles for bedrooms, and anti-skid ceramic for bathrooms.')
  ) AS v(project, prompt, response) ON v.project = p.name;
