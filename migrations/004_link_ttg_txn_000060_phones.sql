PRAGMA foreign_keys = ON;

-- Confirmed client/contact numbers for TTG-RCP-000060 / TTG-TXN-000060.
-- These are D1 data links, not frontend aliases. The INSERTs do nothing unless
-- the real tracking job already exists in tracking_jobs.

INSERT OR IGNORE INTO client_job_links (phone_normalized, job_id)
SELECT '260976959694', id
FROM tracking_jobs
WHERE master_transaction_id = 'TTG-TXN-000060'
   OR public_reference = 'TTG-RCP-000060';

INSERT OR IGNORE INTO client_job_links (phone_normalized, job_id)
SELECT '260974716428', id
FROM tracking_jobs
WHERE master_transaction_id = 'TTG-TXN-000060'
   OR public_reference = 'TTG-RCP-000060';
