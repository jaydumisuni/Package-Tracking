PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tracking_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  master_transaction_id TEXT NOT NULL UNIQUE,
  public_reference TEXT,
  client_name TEXT,
  item_name TEXT,
  item_condition TEXT,
  service_type TEXT,
  route TEXT,
  origin_country TEXT,
  destination_country TEXT DEFAULT 'Zambia',
  amount_received REAL DEFAULT 0,
  currency TEXT DEFAULT 'ZMW',
  payment_method TEXT,
  current_stage TEXT NOT NULL DEFAULT 'intake_received',
  status_note TEXT,
  current_location TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tracking_aliases (
  alias TEXT PRIMARY KEY,
  job_id INTEGER NOT NULL,
  FOREIGN KEY(job_id) REFERENCES tracking_jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tracking_alias_job ON tracking_aliases(job_id);
CREATE INDEX IF NOT EXISTS idx_tracking_jobs_stage ON tracking_jobs(current_stage);

CREATE TABLE IF NOT EXISTS tracking_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  stage TEXT,
  note TEXT NOT NULL,
  location TEXT,
  source TEXT DEFAULT 'TTG update',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(job_id) REFERENCES tracking_jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tracking_updates_job_created ON tracking_updates(job_id, created_at DESC);

CREATE TABLE IF NOT EXISTS carrier_shipments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  leg_type TEXT NOT NULL DEFAULT 'seller_to_forwarder',
  carrier TEXT NOT NULL,
  tracking_number TEXT NOT NULL,
  provider TEXT NOT NULL,
  last_status TEXT,
  last_event_code TEXT,
  last_event_at TEXT,
  last_checked_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(job_id) REFERENCES tracking_jobs(id) ON DELETE CASCADE,
  UNIQUE(carrier, tracking_number, leg_type)
);

CREATE INDEX IF NOT EXISTS idx_carrier_shipments_active ON carrier_shipments(active, last_checked_at);
