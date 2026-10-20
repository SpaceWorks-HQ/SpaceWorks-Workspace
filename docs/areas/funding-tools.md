# Funding, impact and admin tools

Manual internal tools for an NGO, non-profit or small operating team. One Funding and impact sidebar entry opens six screens below `/w/[workspaceSlug]/funding`: tracker, grants, donations, programmes and impact, runway, and tool access reviews. Every page, action, export, search result and proof download requires a current active ADMIN or OWNER, an enabled user and a non-archived workspace. Finance-summary visibility does not expose donors or their proof to members.

## Tools

The tracker lists grants, CSR partners, sponsorships, major donors, government schemes and crowdfunding opportunities. Stages run from idea through applying/submitted and awarded/declined to receiving/reporting/closed. Each has an owner, calendar year, asked/awarded/received amounts, application/report/utilisation-certificate deadlines, next action, notes and multiple proposal/agreement/report files. Stage/year totals keep currencies separate. Tenant-checked links connect grants, donations, programmes, CRM organisations/contacts and the existing FinanceFund model.

Grants extend existing CRM organisations as funders. They record purpose, restrictions, award, period, finance fund, programme and opportunity. Child records track expected/received instalments, report deadlines and deliverables with To do/Done states. Every child has its own owner, notes, due date and proof attachments. Grant cards show received and expected totals and report counts.

Donations log donor, date, money in integer minor units/currency, payment mode/reference, PAN/address, receipt number/issued state, foreign-source flag and notes. In-kind gifts have an item description, estimated value and receipt note; estimates stay separate from cash totals. Gifts can link campaigns, pledges, grants, opportunities, programmes and finance funds. These are fundraising records: accounting cash entries remain manual in the existing finance ledger; saving a gift never posts a second ledger entry automatically.

Campaigns have goals, dates, owner, tagged cash raised and progress bars. Recurring gifts/pledges have amount, frequency, first expected instalment and optional final date. Linked cash gifts settle instalments in order, including partial payments; paused/completed pledges stop reminders. Thank-you tracking records who and when, with an overdue reminder for unthanked received gifts.

Donor profiles extend existing CRM contacts. Giving history, first/last gift, lifetime cash and first-time/recurring/lapsed-over-12-months/major segments derive from non-archived received gifts. Major-donor thresholds have an explicit currency. Contact preference, consent and do-not-contact update the CRM fields. Calendar-year retention and campaign summaries are available through the service and durable daily aggregate snapshots for analytics consumers. There is no general analytics job on this base to wire to; the snapshot is its read contract.

Receipt details save the organisation's registered name/address/PAN, 12A/12AB, 80G, FCRA, signatory and number prefix. Monetary INR gifts generate an immutable PDF with a workspace sequence, donor PAN/address, date, amount in words and organisation details. Concurrent retries reuse the stored receipt. Issued facts are locked; Void donation excludes the gift from totals while preserving its receipt. Archive/restore is available separately. Corrected gifts use a new record. A receipt is not an automatically filed statutory certificate.

Receipt email is explicitly queued through the existing transactional outbox. The payload carries a generated-file reference; delivery resolves the PDF from private storage and rechecks the current gift, contact email and email consent. It attaches the PDF rather than giving a non-member an inaccessible private URL. Sending requires granted consent, email preference and no do-not-contact flag. Real SMTP delivery is not exercised by tests.

Programmes have KPIs with target/unit and either summed or latest-value progress. Periodic manual entries carry evidence files. The printable report uses saved entries. Save impact report PDF stores a dated snapshot in the programme's private attachments; it uses the existing Gilroy font and pagination.

Runway records one monthly cash forecast per currency: opening balance, expected income and expected expenses. The chart shows opening cash divided by positive net monthly burn; income covering expenses gets a plain sentence. Values are estimates from manual entries.

Tool accounts extend existing catalogue items/subscriptions with a person, identity and access level. Preparing a quarter creates one review per current account; retries preserve existing checklists. Decisions require a review note before sign-off. Signed reviews and their attachments are immutable. The person filter presents an access handover prompt. The existing offboarding tool also reads those accounts and adds required referenced revoke-access checklist items; removal in external tools remains manual.

## Data, access and files

The single `20261020230000_funding_tools` migration appends FundingKind, FundingRecord, FundingAttachment and FundingAnalyticsSnapshot. Common fields use typed columns; kind-specific fields are validated with Zod. Workspace cascades cover every new model. Parent, finance fund and attachment relations use compound tenant keys; indexes start with workspaceId. CRM/catalogue/subscription/user references are checked in the owning workspace before every save.

Mutations resolve the tenant server-side, recheck current access and serialize under a short workspace row lock. Actions rate-limit and return UI-safe validation errors. Audit and activity contain generic change facts, never donor PAN or proof contents. Search indexes titles only with PRIVATE visibility and owner scope; search, activity and assistant reads recheck the live admin-only source. Machine-token and scheduled assistant searches do not expose funding records.

Every record supports up to 20 private image/PDF attachments through uploadWorkspaceFile and `/api/files/[id]`. Drag/drop, multiple selection, mobile camera capture and authorised image/PDF previews use the existing configured type/size policy. File rows and objects use existing Silo/S3/R2 storage only. Parent-record permissions apply even when the file is outside the reserved folder. Orphan uploads cannot be downloaded. Funding files are excluded from library reads, alternate library mutations and library purge. Generated receipts cannot be detached. Signed reviews and archived records lock attachment changes.

Each screen has filters, pagination, statuses, owners, notes, CSV export, loading/error handling and a Patch empty state. Controls wrap on narrow screens, fields use associated labels/errors, status carries words and operations announce pending/error results. The browser prohibition means mobile appearance and assistive technology were inspected in code, not exercised interactively.

CSV exports are admin-only, private/no-store, audited, limited to 10,000 records and formula-neutralised. The donation filing CSV includes donor/PAN/address, date, amount, currency, mode, type, foreign-source flag and receipt facts. It prepares Form 10BD records; it is not an automatic portal upload or legal determination. Confirm the applicable filing format and tax year with the organisation's CA.

## Reminders and analytics

The existing scheduler runs `lib/scheduled/funding.ts`. Workspace locks and durable event keys deduplicate due/overdue notifications across replicas. Active admin owners receive reminders, falling back to active admins. Personal-only dispatch events cover deadlines, missed pledges and unthanked gifts without donor identity, PAN, amounts or proof. Mark completed reports/deliverables Done to stop deadline reminders.

An aggregate daily FundingAnalyticsSnapshot, refreshed at most hourly, contains cash/in-kind currency totals, donor counts, calendar-year retention and campaign summaries. It contains no donor profiles or proof. Future analytics consumers can read this tenant-scoped snapshot rather than querying private identities.

## Files outside area ownership

- `prisma/schema.prisma` and `prisma/migrations/20261020230000_funding_tools/migration.sql`: required tenant data, FinanceFund reuse and private attachment ancestry.
- `lib/roles.ts`, `lib/nav.ts`: admin capability helpers and the single sidebar link.
- `lib/notify/events.ts`, `lib/scheduled/index.ts`: three personal reminder events and scheduler registration.
- `lib/files.ts`, `lib/files/service.ts`, `lib/files/versions.ts`: live proof permissions, reserved-folder/library mutation guards and purge exclusion.
- `lib/search/query.ts`, `lib/assistant/tools/workspace.ts`: live funding source checks for search, activity and assistant access.
- `lib/people/onboarding.ts`, `lib/people/checklistItems.ts`: read-only account handover prompts in existing offboarding.
- `lib/outbox.ts`, `lib/email/send.ts`, `lib/email/templates.ts`: private stored-PDF references and attachment delivery through the existing outbox/transport.
- `frontend/catalog.json`, `lib/frontend/*`, `lib/views/generated/*` and generated frontend transport files: required catalogue and split-frontend regeneration; no stale generated view modules remain.

No dependency, README, deployment/release, seed-runner, other worktree, browser or Docker changes were needed.

## Verification

- Both named databases migrated; private Silo bucket initialised.
- Seed checked twice in a temporary workspace: 20 funding records and one reused finance fund, then fixture removed.
- Lint: pass with zero warnings. Backend and frontend typechecks: pass with the requested 4 GB Node heap.
- Unit tests: 1,009 passed, one inherited skipped test. Funding-specific unit tests: 10.
- Full PostgreSQL integration suite with Silo: 429 passed across 42 files. Funding-specific integration tests: 14, covering current authz, tenant isolation, finance funds, main flows, proof permissions, immutable PDFs, consent, offboarding and reminder races.
- Production build: pass with the requested 4 GB Node heap. Root `.next` removed after final verification.
- Required commit-message branding scan: clear. Repository scan: 31 inherited matches in the existing notepad model, migration and callers. The same baseline is documented by earlier areas; funding introduces no matching identifiers. This gate remains unclean; historical migrations and unrelated models were preserved.
- No feature stubs. Real SMTP and browser/mobile visual testing remain unverified. No commits, pushes, merges or rebases were performed; the resumed work remains uncommitted.

Suggested logical commits: `feat(funding): add tenant data and shared access hooks`; `feat(funding): complete manual funding and impact tools`; `test(funding): verify private proof, receipts and reminders`. Apply the task's co-author trailers when committing these changes.
