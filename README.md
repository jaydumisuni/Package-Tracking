# THETECHGUY Package Tracking

Customer-facing tracking site for THETECHGUY DIGITAL SOLUTIONS.

Public hostname: `tracking.thetechguyds.com`

The site resolves TTG document references (receipt, invoice, disclaimer, quote, and master transaction IDs) to one tracking/job view.

## Architecture

This repository is now a Cloudflare Worker + Static Assets application.

- Static UI: `public/`
- Worker API: `src/worker.js`
- D1 schema: `schema.sql`
- Worker config: `wrangler.toml`
- Backend contract: `docs/TRACKING_BACKEND.md`
- Document/staff intake and notification continuity: `docs/TRACKING_INTAKE_AND_NOTIFICATION_CONTRACT.md`

Public tracking uses TTG references only. Supplier and carrier tracking numbers are private operational data stored in D1 and are never returned by the public tracking endpoint.

## Main flows

- `GET /api/track?id=TTG-...` — client tracking lookup
- phone-number lookup when the client phone is linked to the D1 job
- `POST /api/maya` — tracking-scoped Maya assistance
- authenticated admin endpoints — create/update jobs, notes and private carrier links
- document/Hunter workflows create or reuse one master transaction for trackable jobs
- scheduled carrier sync — checks active carrier links when provider credentials are configured

The first carrier leg can represent seller → shipping company/forwarder. For that leg, the public TTG stage remains `seller_shipped` while the parcel is moving through the seller's carrier; when the carrier reports delivery to the shipping company/forwarder, TTG can advance automatically to `shipping_company_received`.

Until every provider is automated, staff/Hunter must keep active jobs live through the human-update continuity rule in `docs/TRACKING_INTAKE_AND_NOTIFICATION_CONTRACT.md`: no handoff without a D1 update or an explicit pending-next-update note.

## Client Portal

`public/client-portal.html` contains:

- referral information
- route delivery/transit guidance
- links back to the main THETECHGUY site and Events

Delivery estimates are intentionally kept out of the main tracking result page.

## D1 setup

Create a Cloudflare D1 database, apply `schema.sql`, then bind it to the Worker as:

`TRACKING_DB`

Add an admin secret:

`ADMIN_TOKEN`

Real customer data and real carrier tracking numbers must be entered into D1/admin APIs, never committed to GitHub.

## Optional FedEx sync

The Worker contains a FedEx adapter that remains inactive until official FedEx credentials and endpoint variables are configured as Worker secrets/variables. See `docs/TRACKING_BACKEND.md`.

## Commands

- Local dev: `npm run dev`
- Deploy: `npm run deploy`

Hunter can later take over the same admin/API contract when maintenance is complete; the tracking data model does not need to change.

## Source-recovery rule

GitHub source, deployed Worker behavior, D1 migrations, and frontend route expectations must stay aligned. If documentation/frontend references a route that the committed Worker does not expose, treat it as an implementation/recovery mismatch rather than assuming the route is safely reproduced from GitHub.
