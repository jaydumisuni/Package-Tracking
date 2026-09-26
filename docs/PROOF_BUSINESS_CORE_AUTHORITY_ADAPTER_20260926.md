# Package Tracking -> Business Core authority adapter proof — 2026-09-26

## Scope

Migration of Package Tracking from mixed D1/Business Core master-transaction allocation to the Decision 0022 authority boundary.

Base: `b987ac1` — Route Document Operations reservations through Business Core.
Branch: `impl/business-core-authority-adapter-20260926`.

This slice does not deploy production and does not move tracking stages/carrier truth out of D1.

## Authority boundary

- Business Core/PostgreSQL is the sole allocator for `TTG-TXN-*`.
- Package Tracking/D1 remains authoritative for tracking jobs, stages, carrier legs, phone links and public tracking presentation.
- Tracking stores only Business Core relationship-sync status; it does not mirror or manufacture Business Core transaction truth.
- Business Core `domain_references` receives linkage only: `domain=tracking`, `reference_type=job`, `reference_value=<TTG-TXN-*>`.

## Runtime changes

- Removed runtime D1 `TTG-TXN-*` allocation and its fresh-schema/bootstrap creation path.
- `/api/admin/transactions/reserve` now requires a complete Business Core configuration and fails closed on Core outage.
- Document Operations reservation uses the same Business Core-only path.
- A new Tracking job verifies its master transaction in Business Core before the D1 write.
- After D1 creation, Tracking binds the tracking-job reference into Business Core.
- A failed post-D1 reference bind returns `BUSINESS_CORE_REFERENCE_SYNC_PENDING` with `trackingSaved=true`; it cannot report false end-to-end success.
- D1 records `business_core_linked_at`, last error and last attempt time.
- The existing scheduled Worker retries unsynced relationship rows automatically.
- Already-linked D1 jobs do not require Core to remain online for normal tracking-state updates.

## D1 migration readiness

`migrations/004_business_core_reference_sync.sql` adds the relationship-sync columns for existing D1 databases.

`verifyTrackingSchema` now treats those columns as required. This prevents an old table-only schema check from incorrectly reporting ready.

Fresh `schema.sql` and owner bootstrap create the new columns directly and no longer create `tracking_sequences`.

Existing production `tracking_sequences` may remain physically present after migration; runtime code no longer reads it.

## Proof

Repository / authority checks:

```text
git diff --check: PASS
reserve.auth: PASS
reserve.core-required: PASS
reserve.partial-config-fails-closed: PASS
reserve.delegates-once: PASS
reserve.no-d1-fallback: PASS
d1.old-schema-blocked: PASS
d1.migration-004-ready: PASS
d1.fresh-schema-ready: PASS
core.verify-master-before-create: PASS
core.reject-missing-master: PASS
tracking-reference.bind: PASS
tracking-reference.pending-marker: PASS
tracking-reference.cron-retry: PASS
tracking-reference.linked-row-skip: PASS
tracking-reference.no-false-success: PASS
```

Existing Tracking gate:

```text
npm run cf:bootstrap: PASS
device.issue / identity / revoke: PASS
ADMIN_OPS_HANDOFF_OK
OPS_PRIVATE_OWNER_RECOVERY_OK
CLIENT_TRACKING_PUBLIC_UX_OK
```

During proof, the scheduled retry path initially failed because `syncTrackingReference` was called without the D1 argument. The proof caught that runtime defect before ship; the call was corrected and the full gate reran green.

`npm ci` is not a valid gate for this repository because the repository has no package-lock.json. No lockfile was invented as part of this migration.

## Production activation boundary

Do not deploy this branch until:

1. the managed Business Core/PostgreSQL service is deployed and its reconciled legacy high-watermark/IDs are proven;
2. existing Tracking master IDs needed for migration exist in Business Core;
3. D1 migration `004_business_core_reference_sync.sql` is applied;
4. `BUSINESS_CORE_URL` is configured on the Tracking Worker;
5. `BUSINESS_CORE_TOKEN` is installed as a Worker secret;
6. `/api/d1/status` reports the authority-sync columns ready;
7. `/api/health` reports `businessCoreConfigured: true`.

After deployment, the scheduled Worker may backfill existing unsynced D1 jobs through the idempotent Business Core reference endpoint. New master allocation must never fall back to D1.
