ALTER TABLE tracking_jobs ADD COLUMN business_core_linked_at TEXT;
ALTER TABLE tracking_jobs ADD COLUMN business_core_link_error TEXT;
ALTER TABLE tracking_jobs ADD COLUMN business_core_link_attempt_at TEXT;

CREATE INDEX IF NOT EXISTS idx_tracking_jobs_business_core_pending
ON tracking_jobs(business_core_linked_at,business_core_link_attempt_at,id);
