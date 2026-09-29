-- Drops every Spacify object so schema.sql can run again. DELETES ALL DATA.
DROP VIEW     IF EXISTS project_summary;
DROP TABLE    IF EXISTS shared_projects, ai_suggestions, sessions, exports, furniture, rooms, projects, users CASCADE;
DROP FUNCTION IF EXISTS project_access(INT, INT), set_updated_at(), refresh_total_area(), prevent_self_share();
