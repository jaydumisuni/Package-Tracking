# Package Tracking → Business Core authority migration

Status: implementation-ready, production activation intentionally pending.

## Authority boundary

Package Tracking remains authority for:

- D1 tracking jobs
- public tracking stages
- tracking updates
- private carrier links
- customer phone-to-job lookup

Business Core owns:

- universal `TTG-TXN-*` allocation
- existence of the master transaction
- durable cross-domain relationship references

The adapter must never manufacture tracking stage truth in Business Core.

## Runtime order

For a new/update Tracking job while Business Core authority is active:

1. validate the supplied master transaction against Business Core;
2. preflight public/alias references against Business Core;
3. preflight legacy D1 alias ownership to prevent migration-era alias reassignment;
4. commit/upsert the Tracking job in D1;
5. link customer phone records in D1 where supplied;
6. register the D1 job ID, public reference, and aliases as immutable `tracking` domain references in Business Core.

If step 1–3 fails, D1 is untouched.

If step 6 fails after D1 commits, the endpoint returns a Business Core failure with:

```json
{
  "authority": "business-core",
  "d1Committed": true
}
```

The request is safe to retry because D1 upsert and Business Core reference binding are idempotent.

## Reservation cutover

`/api/admin/transactions/reserve` and Document Operations reservation use the same Business Core activation law.

When Business Core is active, a Business Core error must never fall back to the legacy D1 sequence.

Legacy D1 allocation remains available only while Business Core authority is inactive.

## Configuration law

Runtime variables:

- `BUSINESS_CORE_URL`
- `BUSINESS_CORE_TOKEN` — secret
- `BUSINESS_CORE_REQUIRED=true` — explicit production fail-closed flag

States exposed by `/api/health`:

- `businessCoreMentioned`
- `businessCoreConfigured`
- `businessCoreActive`
- `businessCoreStaged`
- `businessCoreRequired`

Activation behavior:

- neither URL nor token and REQUIRED false → inactive legacy compatibility;
- only URL or only token and REQUIRED false → staged/inactive;
- complete URL + token → active;
- REQUIRED true with incomplete config → active but fail-closed with configuration error.

## Safe production activation sequence

Do not activate until managed PostgreSQL Business Core has passed its own allocator/reconciliation proof.

Then:

1. deploy this Tracking adapter with no Business Core activation config;
2. stage `BUSINESS_CORE_TOKEN` as a Worker secret;
3. verify health reports staged/inactive;
4. deploy `BUSINESS_CORE_URL` and `BUSINESS_CORE_REQUIRED=true`;
5. verify health reports configured/active/required;
6. issue one idempotent reservation proof;
7. start one controlled Tracking transaction;
8. verify D1 contains the job;
9. verify Business Core resolves the D1 job ID/public reference/aliases back to the same master transaction;
10. only then continue normal traffic.

If activation fails, do not re-enable legacy allocation while Business Core is still marked required. Fix the dependency or explicitly perform a reviewed rollback.

## Existing D1 reconciliation

Before broad activation, existing D1 jobs/aliases should be reconciled into Business Core references. The runtime adapter prevents a known legacy alias from being silently moved to another master during cutover, but it does not pretend pre-existing relationships were already imported.
