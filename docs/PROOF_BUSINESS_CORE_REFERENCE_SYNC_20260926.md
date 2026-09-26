# Package Tracking -> Business Core reference-sync proof — 2026-09-26

## Scope

Compatibility migration of Package Tracking onto the Business Core authority introduced by Decision 0022.

Base:

- Package Tracking `main = b987ac1`
- Business Core reference runtime proof head = `3f313b9`

This slice does not move tracking stage/carrier/payment truth into Business Core and does not deploy production configuration.

## Authority contract

Package Tracking keeps ownership of:

- D1 tracking jobs and public tracking state;
- stages, notes and location;
- phone links;
- private carrier/shipping facts.

Business Core owns:

- the universal `TTG-TXN-*` master identity;
- immutable cross-domain relationship registration.

When Business Core is configured:

1. `transactions/reserve` delegates master allocation to Business Core.
2. `transactions/start` and direct authenticated `jobs/upsert` verify the supplied master exists in Business Core before D1 mutation.
3. D1 commits the tracking job and immutable alias ownership.
4. Tracking public references are persisted in `business_core_reference_outbox`.
5. The Worker binds each reference to Business Core as:
   - `domain=tracking`
   - `reference_type=public_reference`
   - `source_system=package-tracking`
6. Temporary sync failure remains durable and retries on the existing scheduled trigger.
7. A cross-master immutable-reference conflict is terminal and returns `409`.

The queue carries relationship metadata only. It does not manufacture tracking stages or payment truth.

## Alias authority correction

The previous D1 upsert used:

`ON CONFLICT(alias) DO UPDATE SET job_id=excluded.job_id`

That allowed an existing public alias to move silently between tracking jobs.

The migrated path preflights alias ownership, refuses cross-master reassignment, inserts aliases with `DO NOTHING`, and re-verifies the saved owner.

## Repository proof

The normal Tracking quality gate passed with the new reference proof included:

```text
transaction-reserve checks: PASS
docops-device checks: PASS
ADMIN_OPS_HANDOFF_OK
OPS_PRIVATE_OWNER_RECOVERY_OK
CLIENT_TRACKING_PUBLIC_UX_OK
TRACKING_REFERENCE_SYNC_PASS
LOWER_LEVEL_UPSERT_AUTHORITY_PASS
TRACKING_ALIAS_IMMUTABILITY_PASS
MASTER_VERIFY_BEFORE_D1_WRITE_PASS
DURABLE_REFERENCE_RETRY_PASS
TERMINAL_REFERENCE_CONFLICT_PASS
REFERENCE_RUNTIME_WIRING_PASS
BUSINESS_CORE_TRACKING_REFERENCE_CONTRACT_OK
npm audit during proof install: 0 vulnerabilities
```

The reference proof uses Node's real SQLite engine against `schema.sql`, with a D1-compatible wrapper, so uniqueness, queue updates, retry state and alias ownership execute under SQLite semantics rather than a hand-written data mock.

## Failure boundaries proved

- unknown Business Core master -> `409` before a D1 tracking row is created;
- lower-level authenticated `jobs/upsert` cannot bypass Business Core master verification;
- temporary Business Core reference failure -> D1 job remains valid, sync state is `pending`, HTTP `202`, durable retry retained;
- later retry -> same queued references synchronize idempotently;
- cross-master Business Core relationship conflict -> terminal queue state and HTTP `409`;
- local Tracking alias cannot jump to another master transaction;
- normal successful start -> all Tracking aliases resolve to one D1 job and all are registered as Business Core Tracking references.

## Production boundary

This slice is source/proof only.

Before enabling the migration live:

1. deploy/activate the selected managed PostgreSQL Business Core through migrations 001-008;
2. configure Package Tracking `BUSINESS_CORE_URL` and `BUSINESS_CORE_TOKEN`;
3. apply/verify the D1 `business_core_reference_outbox` schema;
4. verify the existing production transaction `TTG-TXN-000060` resolves through Business Core and its reconciled Tracking reference remains idempotent;
5. run the same transaction-start/reference-sync proof against the live internal Business Core boundary;
6. only then treat D1 transaction allocation as compatibility fallback rather than live authority.
