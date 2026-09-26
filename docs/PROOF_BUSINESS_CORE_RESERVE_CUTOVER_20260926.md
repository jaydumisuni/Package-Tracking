# Business Core reserve cutover proof — 2026-09-26

## Scope

Package Tracking compatibility migration for Decision 0022:

- repository: `jaydumisuni/Package-Tracking`
- base head: `b987ac1827ed976b1499e93bf07bfc0c6566ad4e`
- branch: `impl/business-core-reserve-cutover-20260926`

This slice changes only universal master-transaction allocation authority. D1 remains Package Tracking's tracking-domain source of truth.

## Authority change

The two existing reservation surfaces remain stable:

- `POST /api/admin/transactions/reserve`
- `POST /api/ops/transactions/reserve`

Both now delegate only to TTG Business Core:

```text
Tracking reserve endpoint
  -> Business Core /v1/transactions/reserve
  -> PostgreSQL master allocator
```

There is no D1 allocator fallback.

If Business Core configuration is:

- missing -> HTTP 503 / `BUSINESS_CORE_REQUIRED`
- partial -> HTTP 503 / `BUSINESS_CORE_CONFIGURATION_INCOMPLETE`
- unavailable or returns malformed reservation -> HTTP 503 / `BUSINESS_CORE_RESERVATION_FAILED`

All failures identify `authority: business-core`. Tracking must never mint a local `TTG-TXN-*` during those failures.

## Removed legacy allocator surface

The active/current repository no longer contains:

- `reserveMasterTransaction`
- `RESERVE_SQL`
- `SEQUENCE_TABLE_SQL`
- runtime `legacy-d1` authority
- current-schema/bootstrap creation of `tracking_sequences`

An already-deployed historical `tracking_sequences` table may remain physically in D1 until a separate cleanup migration, but no current code reads or increments it.

## Cross-repo compatibility

Business Core reserve is idempotent. A retry may return the existing master transaction with:

```json
{
  "reserved": false
}
```

Tracking explicitly accepts that response, returns the same master ID, and does not misclassify it as provider failure.

The adapter validates:

- HTTP/provider success;
- positive integer sequence;
- canonical `TTG-TXN-<6+ digits>` master ID;
- boolean `reserved` state.

## Proof

```text
git diff --check: PASS
src/transaction-reserve.js syntax: PASS
src/docops-reserve.js syntax: PASS

check-transaction-reserve:
{
  "ok": true,
  "checks": 35,
  "allocatorAuthority": "business-core-only",
  "adminFailClosed": true,
  "docOpsFailClosed": true
}

cf:bootstrap:
- transaction reserve contract PASS
- document operations device/session checks PASS
- admin ops handoff PASS
- private ops recovery PASS
- public client tracking UX PASS
```

The negative-path log lines during proof are expected: the harness deliberately simulates Business Core outage/malformed responses and confirms no D1 fallback occurs.

## Deployment boundary

This branch is not a production deployment.

Before enabling this cutover live:

1. deploy/prove TTG Business Core on the selected managed PostgreSQL runtime;
2. set `BUSINESS_CORE_URL` and `BUSINESS_CORE_TOKEN` for Package Tracking;
3. prove the live reserve compatibility endpoint delegates to Business Core;
4. prove an idempotent retry returns the same master ID;
5. only then deploy the fail-closed Tracking cutover.

Do not deploy this branch to a Tracking Worker that lacks a reachable Business Core configuration, because new master reservation will intentionally return 503 rather than fall back to D1.
