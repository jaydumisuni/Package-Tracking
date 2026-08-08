# THETECHGUY Package Tracking Backend

## Architecture

The Worker serves both the static tracking UI and API routes.

- `/` and static files -> Worker Static Assets
- `GET /api/track?id=TTG-...` -> public tracking lookup
- `GET /api/client-jobs?phone=...` -> D1 phone lookup for active jobs
- `POST /api/maya` -> tracking-scoped Maya response
- `POST /api/admin/transactions/start` -> canonical transaction-start endpoint: create/update the D1 job, aliases and all supplied client/contact phone links
- `POST /api/admin/jobs/upsert` -> lower-level create/update tracking-job endpoint; also links supplied phone fields
- `POST /api/admin/jobs/update` -> append a TTG tracking note/stage
- `POST /api/admin/client-phone/link` -> repair/backfill one or more phone links on an existing D1 job; not the normal creation flow
- `POST /api/admin/carriers/link` -> link a private carrier number to a TTG job
- `POST /api/admin/carriers/sync` -> force carrier sync
- scheduled trigger -> checks active private carrier links every 15 minutes

## D1

Create a D1 database, apply `schema.sql`, and bind it to the Worker as:

`TRACKING_DB`

D1 is the tracking source of truth. The public UI must not manufacture a tracking record or phone association when D1 does not contain it.

Do not put live customer data or real carrier tracking numbers in frontend code or GitHub migrations.

The public customer lookup uses TTG aliases such as:

- `TTG-RCP-000060`
- `TTG-DOC-000060`
- `TTG-INV-000060`
- `TTG-QTE-000060`
- `TTG-TXN-000060`

All aliases can point to the same `tracking_jobs` row.

## Transaction start — canonical creation flow

When a new TTG master transaction starts, the creating system should call:

`POST /api/admin/transactions/start`

This is the normal creation boundary for document generation, Hunter and staff automation. It creates/updates the tracking job and immediately links every valid client/contact phone supplied with that same transaction.

Example:

```json
{
  "job": {
    "masterTransactionId": "TTG-TXN-000061",
    "publicReference": "TTG-RCP-000061",
    "clientName": "Client name",
    "itemName": "Laptop part",
    "serviceType": "Parts Procurement",
    "route": "USA → Zambia",
    "currentStage": "intake_received",
    "client": {
      "mainPhone": "+260 97x xxx xxx"
    },
    "payment": {
      "senderPhone": "097x xxx xxx"
    }
  },
  "aliases": [
    "TTG-RCP-000061",
    "TTG-DOC-000061"
  ]
}
```

The phone linker reads both flat and nested receipt-style fields, including client/customer/business contacts and payment sender contacts. Duplicate representations of the same number are normalized and stored only once.

If no phone is supplied, ID tracking still works but the response reports `phoneLinked: false`; phone tracking cannot exist until a phone is actually part of D1 truth.

`POST /api/admin/client-phone/link` is therefore a correction/backfill tool only. It should not be part of normal day-to-day transaction creation.

## Client phone lookup

`client_job_links` maps normalized phone numbers to D1 tracking jobs. A job may have more than one phone number and a phone may have more than one active job.

Zambian forms such as `0974716428`, `260974716428`, and `+260 974 716 428` normalize to the same D1 key.

The transaction-start and upsert ingestion layer accepts arrays and common fields such as `clientPhones`, `clientPhone`, `mainPhone`, `senderPhone`, nested `client.mainPhone`, and nested `payment.senderPhone` so the client/business contact and payment/contact number can both be attached automatically to the same transaction.

A phone search returns only the lightweight list of D1 jobs. The UI then loads one selected job through `/api/track`; transaction details are never merged across jobs.

If the number is absent from D1, the response is not Found. If a linked D1 job lacks required client/job data, the UI reports an incomplete record rather than showing a green Found state with blank details.

Phone links use `ON DELETE CASCADE`, so closing/removing a handover job removes its phone links automatically.

## Admin authentication

Add a Worker secret named:

`ADMIN_TOKEN`

Admin write endpoints require:

`Authorization: Bearer <ADMIN_TOKEN>`

This is the temporary owner/Hunter write boundary. When Hunter returns from maintenance, Hunter can call the same endpoints rather than changing the tracking data model.

## Private carrier tracking

Carrier tracking numbers are stored only in `carrier_shipments`.

They are intentionally excluded from `/api/track` responses and from the customer-facing HTML.

Use `leg_type` to describe what the carrier number represents:

- `seller_to_forwarder` — seller/eBay/Amazon/etc. to the shipping company/forwarder in the origin country
- `international_to_zambia` — forwarder/shipping company to Zambia

For a `seller_to_forwarder` leg, carrier movement keeps the public TTG stage at `seller_shipped`. When the carrier reports delivery to the forwarder, the Worker may advance the TTG stage to `shipping_company_received` automatically.

For an `international_to_zambia` leg, carrier movement may advance to `in_transit_to_zambia`; Zambia arrival/handoff may advance to `received_in_zambia`.

## FedEx adapter

The Worker includes an optional FedEx polling adapter. It is inactive until the following Worker secrets/variables are configured:

- `FEDEX_API_KEY`
- `FEDEX_SECRET_KEY`
- `FEDEX_TOKEN_URL`
- `FEDEX_TRACK_URL`

Use the official FedEx Developer Portal values for the selected environment. Do not commit FedEx credentials to the repository.

The adapter stores the latest carrier scan as an internal tracking update and maps the first-mile delivered event to `shipping_company_received` for `seller_to_forwarder` shipments.

## Maya

Maya on this site is restricted to tracking/shipping context. The current Worker response layer is intentionally lightweight while Hunter is under maintenance. It reads the selected D1 tracking record when available and answers about:

- current stage
- what happens next
- seller/carrier handoffs
- delivery estimates
- customs / local handoff
- TTG tracking documents

When Hunter is restored, the `/api/maya` route can be upgraded to call Hunter while preserving the same UI and D1 tracking context.
