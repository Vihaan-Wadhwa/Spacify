-- ════════════════════════════════════════════════════════════════════
--  Spacify — example queries (for the report / viva)
--  Run after seeding:  psql "$DATABASE_URL" -f db/queries.sql
-- ════════════════════════════════════════════════════════════════════

-- Q1. JOIN + GROUP BY: every project with its owner, room count and area (the project_summary view).
SELECT * FROM project_summary ORDER BY id;

-- Q2. All projects a user can open: owned UNION shared, with the access level.
SELECT p.id, p.name, 'owner' AS access
  FROM projects p JOIN users u ON u.id = p.user_id
 WHERE u.email = 'demo@spacify.in'
UNION ALL
SELECT p.id, p.name, s.permission
  FROM shared_projects s
  JOIN projects p ON p.id = s.project_id
  JOIN users u    ON u.id = s.shared_with
 WHERE u.email = 'demo@spacify.in'
ORDER BY id;

-- Q3. Calling the access-control function.
SELECT u.email, p.name, project_access(u.id, p.id) AS access
  FROM users u CROSS JOIN projects p
 ORDER BY u.id, p.id;

-- Q4. Area per floor, per project (GROUP BY two columns).
SELECT p.name, r.floor, COUNT(*) AS rooms, SUM(r.width * r.length) AS area_sqft
  FROM rooms r JOIN projects p ON p.id = r.project_id
 GROUP BY p.name, r.floor
 ORDER BY p.name, r.floor;

-- Q5. HAVING: projects with more than 5 rooms.
SELECT p.name, COUNT(r.id) AS rooms
  FROM projects p JOIN rooms r ON r.project_id = p.id
 GROUP BY p.id
HAVING COUNT(r.id) > 5;

-- Q6. Nested subquery: rooms larger than the average room in their own project (correlated).
SELECT p.name AS project, r.room_type, r.width * r.length AS area
  FROM rooms r JOIN projects p ON p.id = r.project_id
 WHERE r.width * r.length > (SELECT AVG(r2.width * r2.length) FROM rooms r2 WHERE r2.project_id = r.project_id)
 ORDER BY p.name, area DESC;

-- Q7. LEFT JOIN: rooms that have no furniture yet.
SELECT p.name AS project, r.room_type
  FROM rooms r
  JOIN projects p       ON p.id = r.project_id
  LEFT JOIN furniture f ON f.room_id = r.id
 WHERE f.id IS NULL;

-- Q8. Furniture footprint as a share of each room's floor area.
SELECT r.room_type, f.name, ROUND(100 * f.width * f.length / (r.width * r.length), 1) AS pct_of_floor
  FROM furniture f JOIN rooms r ON r.id = f.room_id
 ORDER BY pct_of_floor DESC;

-- Q9. Activity per user: exports and AI questions (aggregates over two child tables).
SELECT u.name,
       (SELECT COUNT(*) FROM exports e        WHERE e.user_id = u.id) AS exports,
       (SELECT COUNT(*) FROM ai_suggestions a WHERE a.user_id = u.id) AS ai_questions
  FROM users u;

-- Q10. Trigger demo inside a transaction (rolled back, so data is unchanged):
--      resizing a room updates projects.total_area and updated_at automatically.
BEGIN;
SELECT name, total_area, updated_at FROM projects WHERE name = 'Sample 2BHK';
UPDATE rooms SET width = width + 2
 WHERE room_type = 'Living Room' AND project_id = (SELECT id FROM projects WHERE name = 'Sample 2BHK');
SELECT name, total_area, updated_at FROM projects WHERE name = 'Sample 2BHK';
ROLLBACK;

-- Q11. Active sessions per user (LEFT JOIN + FILTER, so users with none show 0).
--      sessions.token is a SHA-256 hash of the cookie's token; the raw token is never stored.
SELECT u.email,
       COUNT(s.id) FILTER (WHERE s.expires_at > now()) AS active_sessions,
       MAX(s.created_at)                               AS last_login
  FROM users u
  LEFT JOIN sessions s ON s.user_id = u.id
 GROUP BY u.id
 ORDER BY u.id;

-- Q12. What the app runs on every request to find out who is logged in ($1 = sha256 of the cookie).
--      Shown here with a hash that matches nothing, so it returns no rows.
SELECT u.id, u.name, u.email
  FROM sessions s JOIN users u ON u.id = s.user_id
 WHERE s.token = encode(sha256('not-a-real-token'::bytea), 'hex') AND s.expires_at > now();

-- Q13. Housekeeping: delete expired sessions (the app also does this per user on each login).
DELETE FROM sessions WHERE expires_at <= now() RETURNING user_id, expires_at;
