# Package Tracking → Business Core authority proof — 2026-09-26

## Scope

Complete the first Decision 0022 consumer migration slice without moving tracking-stage truth out of D1.

Base authority work already present:

- `8b4894a` — delegate transaction reservation to Business Core
- `b987ac1` — route Document Operations reservations through Business Core

This slice completes runtime master verification, legacy-D1 collision preflight, domain-reference registration, fail-closed error reporting, health visibility, and one shared Business Core adapter.

## Authority order

When Business Core authority is active:

```text
Business Core master/reference preflight
→ legacy D1 reference collision preflight
→ D1 tracking job commit
→ client phone link when supplied
→ Business Core tracking domain-reference registration
```

Package Tracking remains authority for tracking jobs/stages/updates/carrier truth.

Business Core owns universal `TTG-TXN-*` identity and durable cross-domain relationships.

## Failure semantics

Before D1 commit:

- invalid/missing Business Core master → reject
- Business Core reference collision → reject
- legacy D1 alias/public-reference collision → reject
- D1 remains untouched

After D1 commit:

- Business Core reference registration failure returns `d1Committed: true`
- retry remains safe because D1 upsert and Business Core reference binding are idempotent

When Business Core authority is active, reserve failure never falls back to the legacy D1 allocator.

## Activation law

- no URL/token and REQUIRED false → legacy/inactive
- one half of URL/token staged and REQUIRED false → staged/inactive
- complete URL + token → active
- REQUIRED true + incomplete config → active/fail-closed

This permits safe secret/config staging without a temporary cutover outage.

## Focused proof

```text
check-business-core-authority:
  checks: 51
  authorityOrder: core-preflight->d1->core-bind
  handlerSimulation: true
PASS
```

Explicitly proved:

- unauthorized admin upsert causes zero Business Core probes
- complete URL+token activates authority
- partial staged config does not activate
- REQUIRED incomplete config fails closed
- legacy D1 allocator does not advance on required/incomplete Core config
- Business Core reserve delegation is idempotent
- master verification precedes D1 mutation
- cross-master Business Core reference collision is rejected
- legacy D1 alias collision is rejected before D1 mutation
- successful transaction start commits D1 then binds D1/public/alias references
- post-D1 Core failure returns `d1Committed: true` while the D1 job actually exists

## Full Package Tracking gate

```text
npm run cf:bootstrap
PASS

transaction reserve checks: 19
docops device checks: PASS
ADMIN_OPS_HANDOFF_OK
OPS_PRIVATE_OWNER_RECOVERY_OK
CLIENT_TRACKING_PUBLIC_UX_OK
Business Core authority checks: 51
```

Expected stderr during negative-path tests:

- BUSINESS_CORE_CONFIGURATION_INCOMPLETE
- simulated postgres unavailable
- LEGACY_D1_REFERENCE_COLLISION
- simulated post-D1 Business Core reference failure

Those messages are proof fixtures, not live failures.

## Production boundary

This slice does not activate Business Core in the live Tracking Worker.

Before activation:

1. deploy/select managed PostgreSQL Business Core;
2. reconcile legacy TTG transaction high-water mark and existing master identities;
3. apply/prove Business Core migrations;
4. reconcile existing D1 tracking jobs/aliases into Business Core domain references;
5. stage the Tracking Business Core token;
6. verify health shows staged/inactive;
7. deploy Business Core URL + `BUSINESS_CORE_REQUIRED=true`;
8. verify health shows configured/active/required;
9. run one controlled reservation + transaction-start proof;
10. verify D1 and Business Core resolve to the same master transaction.

No fallback to the D1 master allocator is permitted after production authority activation.
