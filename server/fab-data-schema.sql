CREATE TABLE IF NOT EXISTS fab_data_runs (
 id TEXT PRIMARY KEY,
 equipment_id TEXT NOT NULL,
 chamber_id TEXT NOT NULL,
 run_id TEXT NOT NULL,
 payload_json TEXT NOT NULL,
 sha256 TEXT NOT NULL,
 received_by TEXT NOT NULL REFERENCES users(id),
 received_at TEXT NOT NULL,
 source TEXT NOT NULL CHECK(source IN ('equipment-export','synthetic')),
 UNIQUE(equipment_id,chamber_id,run_id)
);
