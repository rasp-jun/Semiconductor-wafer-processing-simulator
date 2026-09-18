CREATE TABLE IF NOT EXISTS equipment_schema_version(version INTEGER PRIMARY KEY);
INSERT OR IGNORE INTO equipment_schema_version VALUES(1);
CREATE TABLE IF NOT EXISTS equipment_runs(
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
 series_id TEXT NOT NULL REFERENCES equipment_runs(id), revision INTEGER NOT NULL,
 parent_id TEXT REFERENCES equipment_runs(id), baseline_id TEXT REFERENCES equipment_runs(id),
 title TEXT NOT NULL, lot_id TEXT NOT NULL, change_reason TEXT NOT NULL, source_name TEXT NOT NULL,
 trace_json TEXT NOT NULL, trace_sha256 TEXT NOT NULL, summary_json TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','reviewed','rejected')),
 reviewer_id TEXT REFERENCES users(id), review_note TEXT, reviewed_at TEXT,
 lock_version INTEGER NOT NULL DEFAULT 1, request_key TEXT NOT NULL, request_sha256 TEXT NOT NULL,
 UNIQUE(series_id,revision), UNIQUE(created_by,request_key)
);
CREATE INDEX IF NOT EXISTS equipment_project_time ON equipment_runs(project_id,created_at);
CREATE TRIGGER IF NOT EXISTS immutable_equipment_content BEFORE UPDATE OF id,project_id,series_id,revision,parent_id,baseline_id,title,lot_id,change_reason,source_name,trace_json,trace_sha256,summary_json,created_by,created_at,request_key,request_sha256 ON equipment_runs
 BEGIN SELECT RAISE(ABORT,'Equipment evidence content is immutable'); END;
CREATE TRIGGER IF NOT EXISTS no_equipment_delete BEFORE DELETE ON equipment_runs
 BEGIN SELECT RAISE(ABORT,'Equipment evidence cannot be deleted'); END;
