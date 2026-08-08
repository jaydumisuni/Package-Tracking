PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS handover_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  handover_method TEXT NOT NULL DEFAULT 'customer_link',
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(job_id) REFERENCES tracking_jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_handover_tokens_job ON handover_tokens(job_id);
CREATE INDEX IF NOT EXISTS idx_handover_tokens_expiry ON handover_tokens(expires_at, used_at);
