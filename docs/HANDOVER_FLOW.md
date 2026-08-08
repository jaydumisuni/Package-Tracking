# TTG handover closeout

## Purpose

The handover flow closes a live tracking job without keeping completed client history in D1 indefinitely.

1. Staff generates a one-time handover link for a job that is `ready_for_collection` or `completed`.
2. The client opens the link (or staff opens it in store), reviews the transaction and signs.
3. The Worker hashes the signature and appends one compact row to the **TTG Handover Register** Google Sheet.
4. Only after the Sheets append succeeds, the Worker deletes the tracking job from D1. D1 foreign-key cascades remove its aliases, tracking updates, carrier links and handover token.

The raw drawn signature is never stored permanently. The archive retains the signed name, timestamp and SHA-256 digest of the submitted signature as compact proof.

## Google Sheet

Spreadsheet: `TTG Handover Register`

Columns:

1. Master ID
2. Public Reference
3. Client Name
4. Item / What Was Bought
5. Service Type
6. Amount Paid
7. Handover Date
8. Handover Method
9. Signed Name
10. Signature SHA-256
11. Confirmation Version
12. Closed By / Source

The spreadsheet ID and range are non-secret Worker variables in `wrangler.toml`.

## Required Cloudflare secrets

The Worker writes directly to the Google Sheets API using a Google service account. Configure these Worker secrets:

- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`

Share the **TTG Handover Register** spreadsheet with the service-account email as **Editor**. Do not commit the private key to GitHub.

## Generate a one-time handover link

```http
POST /api/admin/handover/create
Authorization: Bearer <ADMIN_TOKEN>
Content-Type: application/json

{
  "reference": "TTG-RCP-000060",
  "method": "customer_link",
  "expiresHours": 72
}
```

For in-store signing use `"method": "in_store"`.

The endpoint returns a URL such as:

```text
https://tracking.thetechguyds.com/handover.html?t=<one-time-token>
```

The raw token is returned once and only its SHA-256 hash is stored in D1.

## Public handover endpoints

- `GET /api/handover?token=...` — returns customer-safe job details for a valid token.
- `POST /api/handover/confirm` — receives signed name, temporary signature image and acceptance flag; archives to Sheets and then deletes the D1 job.

A receipt/tracking ID by itself cannot authorize handover closure.
