PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS client_job_links (
  phone_normalized TEXT NOT NULL,
  job_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (phone_normalized, job_id),
  FOREIGN KEY(job_id) REFERENCES tracking_jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_client_job_links_phone ON client_job_links(phone_normalized);
CREATE INDEX IF NOT EXISTS idx_client_job_links_job ON client_job_links(job_id);
