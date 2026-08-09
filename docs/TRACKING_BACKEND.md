# THETECHGUY Package Tracking Backend

## Architecture

The Worker serves both the static tracking UI and API routes.

- `/` and static files -> Worker Static Assets
- `GET /api/track?id=TTG-...` -> public D1 tracking lookup
- `GET /api/client-jobs?phone=...` -> D1 phone lookup for active jobs
- `POST /api/maya` -> tracking-scoped Maya response
- `POST /api/admin/transactions/reserve` -> atomically reserve the next D1-owned master `TTG-TXN-*` ID
- `POST /api/admin/transactions/start` -> canonical transaction-start endpoint: create/update the D1 job, aliases and all supplied client/contact phone links
- `POST /api/admin/jobs/upsert` -> lower-level tracking-job upsert; also links supplied phone fields
- `POST /api/admin/jobs/update` -> append a TTG tracking note/stage
- `POST /api/admin/client-phone/link` -> historical repair/backfill for one or more phone links; not normal creation flow
- `POST /api/admin/carriers/link` -> link a private carrier number to a TTG job
- `POST /api/admin/carriers/sync` -> force carrier sync
- scheduled trigger -> checks active private carrier links every 15 minutes

## D1 source of truth

Bind the production D1 database to the Worker as `TRACKING_DB` and apply `schema.sql` plus migrations in order.

D1 is the tracking source of truth. The public UI must never manufacture a tracking record, phone association, customer state or green Found result when D1 does not contain a complete record.

Do not put live customer data, real client phone numbers, real transaction IDs or private carrier tracking numbers into public examples, frontend code, documentation examples or GitHub migrations.

Generic alias forms:

- `TTG-RCP-XXXXXX`
- `TTG-DOC-XXXXXX`
- `TTG-INV-XXXXXX`
- `TTG-QTE-XXXXXX`
- `TTG-TXN-XXXXXX`

All aliases for one transaction point to the same `tracking_jobs` row.

## Master transaction reservation

A new trackable workflow that does not already have a master transaction must call:

`POST /api/admin/transactions/reserve`

before assigning its public document aliases.

The reservation is owned by D1. `tracking_sequences` keeps a monotonic transaction sequence and also catches up to any higher numeric `TTG-TXN-*` already present in `tracking_jobs`. A reservation is never manufactured in a browser, local document app, Hunter prompt, or Git repository.

Synthetic response shape:

```json
{
  "ok": true,
  "reserved": true,
  "sequence": 123,
  "masterTransactionId": "TTG-TXN-000123"
}
```

Reserved IDs are not recycled if a later document workflow is cancelled. Gaps are acceptable; duplicate transaction identity is not.

An existing transaction must reuse its current master ID and must not reserve a second ID for another quote, invoice, receipt, disclaimer or later tracking stage.

## Transaction start — canonical creation flow

When a new TTG master transaction starts, the creating system should call:

`POST /api/admin/transactions/start`

This is the normal creation boundary for document generation, Hunter and staff automation. It creates/updates the tracking job and immediately links every valid client/contact phone supplied with that same transaction.

Synthetic payload shape:

```json
{
  "job": {
    "masterTransactionId": "TTG-TXN-XXXXXX",
    "publicReference": "TTG-RCP-XXXXXX",
    "clientName": "Client name",
    "itemName": "Tracked item",
    "serviceType": "Parts Procurement",
    "route": "Origin → Zambia",
    "currentStage": "intake_received",
    "client": {
      "mainPhone": "+260 9XX XXX XXX"
    },
    "payment": {
      "senderPhone": "09XX XXX XXX"
    }
  },
  "aliases": [
    "TTG-RCP-XXXXXX",
    "TTG-DOC-XXXXXX"
  ]
}
```

The phone linker reads flat and nested receipt-style fields, including client/customer/business contacts, WhatsApp fields and payment sender contacts. Duplicate representations of the same number normalize to one D1 key.

If no phone is supplied, ID tracking still works but the response reports `phoneLinked: false`; phone lookup cannot exist until a phone is part of D1 truth.

`POST /api/admin/client-phone/link` is therefore a correction/backfill tool only.

## Client phone lookup

`client_job_links` maps normalized phone numbers to D1 tracking jobs. A job may have more than one phone number and a phone may have more than one active job.

Accepted Zambia input forms are normalized, for example:

- `09XX XXX XXX`
- `260 9XX XXX XXX`
- `+260 9XX XXX XXX`

A phone search returns only a lightweight list of active D1 jobs. The UI then loads one selected job through `/api/track`; transaction details are never merged across jobs.

If the number is absent from D1, the response is not Found. If a linked D1 job lacks required client/job data, the UI reports an incomplete record rather than showing a green Found state with blank details.

Phone links use `ON DELETE CASCADE`, so deleting a completed handover job removes its phone links automatically.

## Admin authentication

Admin write endpoints require Worker secret `ADMIN_TOKEN` and:

`Authorization: Bearer <ADMIN_TOKEN>`

This is the temporary owner/Hunter machine-to-machine write boundary. Browser staff sign-in uses the separate Tracking Operations/TTG Auth path; the admin token must not be typed into ordinary staff UI.

## Private carrier tracking

Carrier tracking numbers are stored only in `carrier_shipments` and are excluded from public tracking responses.

Use `leg_type`:

- `seller_to_forwarder` — seller/vendor to the origin-country shipping company/forwarder
- `international_to_zambia` — forwarder/shipping company to Zambia

For `seller_to_forwarder`, carrier movement keeps the public stage at `seller_shipped`; delivery to the forwarder advances to `shipping_company_received`.

For `international_to_zambia`, movement may advance to `in_transit_to_zambia`; Zambia arrival/handoff may advance to `received_in_zambia`.

Shipping cost/payment is handled after the parcel reaches the Zambia local pickup center, not at the origin-country forwarder.

## FedEx adapter

The optional FedEx poller remains inactive until these Worker values are configured:

- `FEDEX_API_KEY`
- `FEDEX_SECRET_KEY`
- `FEDEX_TOKEN_URL`
- `FEDEX_TRACK_URL`

Do not commit carrier credentials.

## Maya

Maya is restricted to the selected D1 tracking record and shipping/procurement context. She may explain:

- current stage
- dated tracking history
- what happens next
- seller/carrier handoffs
- delivery estimates
- shipping-cost state
- customs/local handoff
- linked TTG documents

When Hunter is available, `/api/maya` may call Hunter while preserving the same selected D1 tracking context.
