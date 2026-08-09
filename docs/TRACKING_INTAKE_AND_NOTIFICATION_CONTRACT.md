# Tracking Intake and Notification Continuity Contract

This contract defines how Hunter, Document Generator workflows, staff/admin tools, and future automation keep one live TTG tracking job complete from intake through completion.

## Source of truth

D1 is the tracking source of truth.

The public tracking site must only show state that exists in D1. Notifications, emails, WhatsApp messages, Maya replies, and app alerts must not invent a stage or shipment state that has not been written to the D1 job.

## Transaction creation from documents

A document workflow may start or continue a tracking job.

When a quote, invoice, receipt, disclaimer/intake, or order belongs to a service that needs ongoing tracking, the caller must create or reuse the same master TTG transaction and register the tracking job through the canonical transaction-start boundary documented in `TRACKING_BACKEND.md`.

The intended creation route is:

`POST /api/admin/transactions/start`

All TTG aliases for the same job must resolve to one D1 `tracking_jobs` record.

## Required contact intake

For a trackable job, callers should supply every known client/contact phone number at transaction start so phone lookup can work without a later repair/backfill operation.

If the client wants email delivery or email tracking notifications, the orchestration layer must also capture the client email address even though email itself is not required by the public tracking lookup.

Do not fake a phone/email value to satisfy a form.

## Supplier/carrier tracking intake

When a supplier/seller issues a tracking number, the operator/Hunter must collect:

- carrier
- tracking number
- TTG master/document reference
- leg type when known

Private carrier links use:

`POST /api/admin/carriers/link`

Supported operational leg meanings include:

- `seller_to_forwarder`
- `international_to_zambia`

A later shipping-company/forwarder tracking number is a new leg. Do not destroy the earlier seller leg/history.

If tracking has not been issued yet, keep the D1 stage accurate and save/communicate that tracking is still pending rather than inventing a carrier number.

## Human update continuity

Before all providers are automated, every active tracking job must remain operable by a human staff member.

At every staff handoff, the operator must know:

- master TTG transaction ID
- client
- item/device/service
- current stage
- latest D1 note/time
- next expected event/information
- whether seller tracking has been collected
- whether international/forwarder tracking has been collected
- whether shipping cost/top-up is pending
- who is responsible for the next update

Operating rule:

`No handoff without a D1 update or an explicit pending-next-update note.`

This prevents a live tracking job becoming stale simply because another person took over the customer/job.

## Update boundary

Meaningful state changes belong in D1 through:

`POST /api/admin/jobs/update`

Examples include:

- deposit/order payment recorded
- parts sourcing
- parts ordered
- awaiting seller shipment
- seller shipped
- shipping company received parcel
- in transit to Zambia
- received in Zambia
- awaiting shipping cost
- shipping cost paid
- parts received by TTG
- repair in progress
- testing
- ready for collection
- completed

Do not create a new tracking job for the next stage of the same transaction.

## Notification event intent

Each meaningful D1 update should be eligible to produce notification events for one or more of:

- owner/admin
- assigned staff/operator
- customer email
- customer WhatsApp
- Hunter/TTG app

Until provider automation is complete, an internal notification may simply tell the responsible person what information must be supplied next.

Examples:

- seller tracking still required
- seller shipment delivered to forwarder; waiting for international tracking
- shipping charge available; customer top-up required
- parcel received in Zambia; local handoff update required
- repair parts received; technician action required
- testing complete; customer collection message required

## Notification truth rule

A notification is downstream of D1 truth.

Correct order:

1. recover/verify the new information,
2. write the D1 update,
3. generate notification intent,
4. send/display through email, WhatsApp, app, or internal owner/staff reminder.

For provider/carrier automation the same rule applies: provider data is normalized into a D1 update first, then notifications are emitted from the saved state.

## Receipt/payment handoff

Package Tracking does not confirm payment truth.

For receipt-driven tracking updates, Pay Gateway/admin-approved payment truth must establish the payment state first. Hunter may extract pasted POP messages/screenshots/cash declarations, but tracking should consume the confirmed/approved transaction state.

## Document Generator handoff

The matching Document Generator contract is:

`jaydumisuni/ttg-document-generator-templates/docs/TRACKABLE_DOCUMENT_INTAKE_AND_D1_HANDOFF.md`

The PDF generator does not own tracking state. Hunter/the caller coordinates the transaction so the generated document and D1 tracking job share the same master transaction and aliases.

## Recovery / source reconciliation

GitHub source, deployed Worker behavior, D1 migrations, and frontend expectations must stay aligned.

If the frontend or documentation references an admin/public route that is missing from `src/worker.js`, treat that as a source-recovery mismatch and reconcile it before declaring the tracking system fully reproducible from GitHub.
