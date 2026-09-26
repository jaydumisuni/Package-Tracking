# Package Tracking -> Business Core adapter proof â€” 2026-09-26

## Scope

Complete Package Tracking's compatibility migration to the Decision 0022 Business Core identity boundary.

Base:

- Package Tracking `main`: `b987ac1` â€” Route Document Operations reservations through Business Core
- Business Core reference contract: `3f313b9` â€” Add runtime domain reference bindings

This slice changes master-identity authority only. D1 remains authoritative for Tracking stages, carrier facts, tracking history, customer tracking presentation and tracking-specific contact links.

## Split-authority paths closed

Runtime Tracking no longer contains a callable D1 `TTG-TXN-*` allocator.

- admin reservation requires Business Core
- Document Operations reservation requires Business Core
- Business Core outage does not fall back to D1
- missing/incomplete Business Core configuration blocks reservation
- fresh D1 schema/bootstrap no longer creates `tracking_sequences`
- an old deployed `tracking_sequences` table may remain physically present but is unused

## Transaction start contract

`POST /api/admin/transactions/start` and lower-level `POST /api/admin/jobs/upsert` now:

1. authenticate the Tracking admin caller;
2. require a canonical master transaction;
3. verify that master transaction against Business Core before D1 persistence;
4. save/update the D1 Tracking job;
5. bind the D1 job ID to Business Core as `tracking/job_id`;
6. bind a distinct public Tracking reference as `tracking/public_reference`;
7. continue Tracking phone-link handling.

Business Core relationships are linkage only. The adapter does not write tracking stages or payment truth into Business Core references.

If D1 persistence succeeds and reference binding then fails, the API returns a recoverable failure with `trackingSaved: true`. A retry reuses the same D1 job and idempotent Business Core natural references.

## Deployment boundary

Do not deploy this branch until both are supplied to the Tracking Worker:

- `BUSINESS_CORE_URL`
- `BUSINESS_CORE_TOKEN`

Production Business Core itself must already have migrations through `008_domain_reference_runtime.sql` and the reconciled allocator must be enabled.

No live deployment is part of this slice.

## Repository proof

Dependency restore:

    npm install: PASS
    34 packages installed
    npm audit during install: 0 vulnerabilities

Business Core adapter proof:

    admin-auth: PASS
    business-core-required: PASS
    partial-config-rejected: PASS
    delegated-reservation: PASS
    no-d1-fallback: PASS
    verify-master-before-d1: PASS
    bind-tracking-job-id: PASS
    bind-tracking-public-reference: PASS
    unauthorized-no-side-effects: PASS
    missing-core-blocks-d1: PASS
    unknown-master-blocks-d1: PASS
    partial-reference-sync-recoverable: PASS

Canonical Package Tracking gate:

    npm run cf:bootstrap: PASS
    device.issue: PASS
    device.identity: PASS
    device.revoke: PASS
    connect.script.syntax: PASS
    ADMIN_OPS_HANDOFF_OK
    OPS_PRIVATE_OWNER_RECOVERY_OK
    CLIENT_TRACKING_PUBLIC_UX_OK

The error lines printed during the adapter checks are expected negative-path fixtures for Business Core outage, unknown master, and post-D1 reference-binding failure. The proof commands exited 0.

Static regression guards also prove that runtime reservation code contains no reserveMasterTransaction, legacy-d1, RESERVE_SQL, or SEQUENCE_TABLE_SQL, and fresh D1 schema/bootstrap contain no tracking_sequences.
