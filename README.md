# THETECHGUY Package Tracking

Customer-facing tracking site for THETECHGUY DIGITAL SOLUTIONS.

Planned public hostname: `tracking.thetechguyds.com`

The site resolves TTG document references (receipt, invoice, disclaimer, quote, and master transaction IDs) to one tracking/job view. The current frontend is a deployable Cloudflare Workers static-assets build; tracking data/API wiring will be connected separately.

## Cloudflare Workers

- Static files: `public/`
- Wrangler config: `wrangler.toml`
- Local dev: `npm run dev`
- Deploy: `npm run deploy`

Hunter will eventually update tracking state automatically. Until that service returns from maintenance, tracking records can be updated through the temporary approved admin workflow.
