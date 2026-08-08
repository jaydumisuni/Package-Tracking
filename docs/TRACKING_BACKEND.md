# THETECHGUY Package Tracking Backend

## Architecture

The Worker serves both the static tracking UI and API routes.

- `/` and static files -> Worker Static Assets
- `GET /api/track?id=TTG-...` -> public tracking lookup
- `POST /api/maya` -> tracking-scoped Maya response
- `POST /api/admin/jobs/upsert` -> create/update a tracking job
- `POST /api/admin/jobs/update` -> append a TTG tracking note/stage
- `POST /api/admin/carriers/link` -> link a private carrier number to a TTG job
- `POST /api/admin/carriers/sync` -> force carrier sync
- scheduled trigger -> checks active private carrier links every 15 minutes

## D1

Create a D1 database, apply `schema.sql`, and bind it to the Worker as:

`TRACKING_DB`

Do not put live customer data or real carrier tracking numbers in GitHub.

The public customer lookup uses TTG aliases such as:

- `TTG-RCP-000060`
- `TTG-DOC-000060`
- `TTG-INV-000060`
- `TTG-QTE-000060`
- `TTG-TXN-000060`

All aliases can point to the same `tracking_jobs` row.

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

Maya on this site is restricted to tracking/shipping context. The current Worker response layer is intentionally lightweight while Hunter is under maintenance. It reads the TTG tracking record when available and answers about:

- current stage
- what happens next
- seller/carrier handoffs
- delivery estimates
- customs / local handoff
- TTG tracking documents

When Hunter is restored, the `/api/maya` route can be upgraded to call Hunter while preserving the same UI and tracking context.
