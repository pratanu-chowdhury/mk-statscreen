-- StatScreen persistence schema (Turso / libSQL / SQLite).
-- The app stores each saved "screening" (JD + predictors + training rows +
-- weights + threshold + candidate pool) as one JSON document. The server
-- creates this table automatically on boot; this file is for reference or
-- manual setup:  turso db shell mk-statscreen < schema.sql

CREATE TABLE IF NOT EXISTS screenings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  data       TEXT NOT NULL,                       -- JSON blob of the full screening
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- OPTIONAL normalized schema, if you later want to query at the SQL level
-- (e.g. "all candidates above 0.7 across every role"). Not used by the app
-- as shipped, but here so you can grow into it.
-- ---------------------------------------------------------------------------
-- CREATE TABLE roles (id INTEGER PRIMARY KEY, name TEXT, jd TEXT, created_at TEXT DEFAULT (datetime('now')));
-- CREATE TABLE predictors (id INTEGER PRIMARY KEY, role_id INTEGER REFERENCES roles(id),
--   name TEXT, short TEXT, kind TEXT, config_json TEXT, fallback REAL, position INTEGER);
-- CREATE TABLE training_rows (id INTEGER PRIMARY KEY, role_id INTEGER REFERENCES roles(id), values_json TEXT, y INTEGER);
-- CREATE TABLE model_runs (id INTEGER PRIMARY KEY, role_id INTEGER REFERENCES roles(id),
--   mode TEXT, smote_on INTEGER, stratify TEXT, beta_json TEXT, metrics_json TEXT, created_at TEXT DEFAULT (datetime('now')));
-- CREATE TABLE candidates (id INTEGER PRIMARY KEY, role_id INTEGER REFERENCES roles(id),
--   name TEXT, resume TEXT, values_json TEXT, prob REAL, forwarded INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
