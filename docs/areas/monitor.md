# Services monitor

Services provides workspace health checks, incident response, maintenance, on-call rotations, cloud inventory and billing summaries. Owners/admins manage; active members view; guests receive 404. A workspace can separately allow members to acknowledge incidents and view costs.

The implementation lives in `lib/monitor`, `components/services`, `app/actions/services.ts`, workspace `services/**`, settings `cloud-accounts`, public `status/**`, heartbeat `api/hb/**`, and `lib/scheduled/monitor.ts`. No schema or migration changes are needed.

Checks include HTTP(S), TCP/TLS, ICMP with TCP fallback, DNS answers, certificate trust/expiry, RDAP domain expiry, scheduled heartbeats, PostgreSQL, Redis, cloud resource health and PromQL. PostgreSQL leases claim due work with `FOR UPDATE SKIP LOCKED`; Redis coordinates rate limits and short claims. Each process limits checks to 20 concurrent, five per target host. Raw checks feed SQL hourly/daily rollups; uptime excludes maintenance and unknown outcomes. Exact percentiles use raw checks; combined historical percentiles are approximations.

Automatic incidents open and resolve after configurable consecutive failures/successes. The fifth incident within one hour invokes the flapping guard and requires 15 stable minutes to recover. Maintenance suppresses opening alerts, reminders and escalations. All notifications use `dispatch`, monitor scoped destinations, workspace rules and incident thread keys. Acknowledgement stops reminders/escalations. Manual timelines, postmortem notes, linked Docs and follow-up Tasks are supported.

Cloud adapters read DigitalOcean, AWS, Render, Cloudflare, Hetzner, Vercel, Netlify, Fly.io, Railway, GitHub Actions and Prometheus. Credentials are encrypted with a dedicated purpose and are write-only. The setup UI shows provider permissions and the AWS read policy. Inventory sync claims accounts with a conditional database update. Missing billing/metrics permissions preserve inventory and show a safe error. Optional monitor creation respects the workspace monitor cap.

Public status is disabled by default and includes only explicitly chosen components. Summary JSON, RSS and SVG badges share a sanitized projection; no monitor IDs, targets, check messages, configuration or credentials are exposed. Automatic incident names/updates are replaced with public display names and generic health descriptions. Public manual copy is admin-authored.

`docs/MONITORING.md` contains deployment, credential and retention guidance. Demo data is in `scripts/seed/monitor.mjs`; it creates no real cloud connection and keeps public sharing disabled.

## Ownership and integration

Outside row 8, the existing `app/api/internal/jobs/route.ts` change is necessary to invoke the shared scheduled registry after bearer authentication. `tests/unit/internal-jobs.test.ts` mocks the newly active registry so its bearer-contract unit tests remain isolated from the database and providers. `package.json` and `package-lock.json` add exact AWS SDK client pins plus `pg`, its types and `tldts`; `cron-parser` was already available. The Task/RecordLink writes for incident follow-ups and workspace counters follow the roadmap's permitted cross-area contracts. Notification rules, search, activity and audit writes go through shared helpers. No deployment files or shared schema were changed.

## Validation

Monitor unit tests cover assertions, SSRF and pinned DNS, incident confirmation/flapping, expiry parsing, heartbeat schedules, recurrence, statistical summaries, provider fixtures and rate handling. Database tests exercise concurrent claims, incident events, maintenance, heartbeat rotation, public opt-in, role/tenant boundaries, credential encryption, SQL rollup idempotency and retention. Provider fetch and SDK calls are mocked. See the task handoff for the final full-suite counts and environment limitations.

## Operational limits

Provider metrics are sampled over recent windows rather than retaining full provider telemetry. DigitalOcean agent metrics cover up to ten healthy droplets per sync; Hetzner metrics cover up to twenty healthy resources. AWS regions are explicit (default us-east-1, maximum ten). Provider inventories have pagination safety limits. Render/Cloudflare and the P1 deployment providers have no billing adapter here; their resource health still syncs. Hetzner monthly pricing is an estimate. These are visible data availability limits, never zero spend claims.

## Verified handoff — 19 October 2026

- Lint: clean, no warnings.
- Typecheck and production build: passed on Next.js 16.4.2.
- Unit suite: 394 passed, including Redis pub/sub with `TEST_REDIS_URL=redis://127.0.0.1:6395/11`; two workers used to reduce host memory pressure.
- Integration suite: 112 passed; hook/test timeouts raised to 60 seconds during host load. All cloud API and SDK calls use fixtures or mocks.
- Standalone production HTTP smoke: 17 checks passed across admin/member/guest routes, public opt-out and unknown heartbeat tokens. Next.js can stream a not-found boundary with HTTP 200 after headers have been sent; denial was checked using the framework's not-found marker as well as the response status.
- Both required brand scans and an additional scan of new files: clear. Demo seed: passed.
- Browser verification remains pending: macOS denied Chromium Mach IPC registration and the connected-browser tool had no available browser. `tests/e2e/monitor-services.spec.ts` contains the 375px admin creation and guest-denial checks, but no browser pass is claimed.
- Git staging/commits were blocked by sandbox denial when creating the worktree metadata `index.lock`. All source work remains uncommitted on `feat/monitor`; nothing was pushed or merged.
