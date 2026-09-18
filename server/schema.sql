PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);
INSERT OR IGNORE INTO schema_version VALUES (1);
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
 password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','engineer','reviewer')),
 active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 csrf TEXT NOT NULL, expires REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS login_attempts (key TEXT NOT NULL, attempted REAL NOT NULL);
CREATE INDEX IF NOT EXISTS login_attempt_time ON login_attempts(key,attempted);
CREATE TABLE IF NOT EXISTS projects (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS recipes (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), name TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS revisions (
 id TEXT PRIMARY KEY, recipe_id TEXT NOT NULL REFERENCES recipes(id), number INTEGER NOT NULL,
 parent_id TEXT REFERENCES revisions(id), params_json TEXT NOT NULL, scenario TEXT NOT NULL,
 model_version TEXT NOT NULL, change_reason TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','rejected')),
 reviewer_id TEXT REFERENCES users(id), review_note TEXT, reviewed_at TEXT,
 lock_version INTEGER NOT NULL DEFAULT 1, UNIQUE(recipe_id,number)
);
CREATE TABLE IF NOT EXISTS experiments (
 id TEXT PRIMARY KEY, revision_id TEXT NOT NULL REFERENCES revisions(id), name TEXT NOT NULL,
 lot_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('simulation','measurement','demo')),
 result_json TEXT NOT NULL, digest TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS experiments_revision ON experiments(revision_id,created_at);
CREATE TABLE IF NOT EXISTS audit (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT REFERENCES users(id),
 action TEXT NOT NULL, entity_id TEXT NOT NULL, details_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS immutable_revision BEFORE UPDATE OF recipe_id,number,parent_id,params_json,scenario,model_version,change_reason,created_by,created_at ON revisions
 BEGIN SELECT RAISE(ABORT,'Recipe revision content is immutable'); END;
CREATE TRIGGER IF NOT EXISTS no_revision_delete BEFORE DELETE ON revisions BEGIN SELECT RAISE(ABORT,'Revisions cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS immutable_experiment BEFORE UPDATE ON experiments BEGIN SELECT RAISE(ABORT,'Experiment records are immutable'); END;
CREATE TRIGGER IF NOT EXISTS no_experiment_delete BEFORE DELETE ON experiments BEGIN SELECT RAISE(ABORT,'Experiments cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS immutable_audit BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'Audit records are append only'); END;
CREATE TRIGGER IF NOT EXISTS no_audit_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'Audit records cannot be deleted'); END;
