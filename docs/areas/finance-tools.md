# Manual finance tools

This area extends the existing ledger, budgets, invoices, money requests and approvals. It is an internal office tool. Entries, payments, tax amounts and statement balances are recorded manually. It does not connect to banks, payroll providers or accounting services, and does not manage public events or member payments.

## Routes and everyday use

All routes are below `/w/[workspaceSlug]/finance`. Every page resolves workspace membership itself. The shared finance loading and error boundaries apply to these screens.

| Route | Tool |
| --- | --- |
| `receipt` | Quick manual entry, optional receipt extraction, multiple proofs and remembered bookkeeping defaults |
| `funds` | Restricted/unrestricted funds, balances, agreements/reports, cost centres and optional project/external event references |
| `budgets` | Existing Budget lines with month/year/custom periods, category and cost centre, actuals and variance notes |
| `bills` | Supplier bills, optional GST/TDS facts, unpaid/partly paid/paid, overdue filter and partial payments |
| `close` | Bank/cash accounts, opening balances, statement comparisons, entry reconciliation marks, editable monthly steps and sign-off |
| `spending` | Category/centre/person comparisons, largest expenses, missing proofs, possible duplicates, review thresholds and monthly sign-off |
| `reports` | Income by source/funder, spending by category/vendor, programme statements, cash-flow chart, budgets, entries and receipts |
| `reports/print` | Printable report for the selected period/currency/cost centre |
| `payroll` | Explicit payroll grants, pay profiles, draft/approved/paid runs, statutory totals, payroll costs and payslips |
| `payroll/[runId]/print` | Audited printable payslip |
| `export/[kind]` | Accountant CSVs for each report, ledger, bills, funds, budgets, disbursements, payroll and statutory amounts |

The sidebar keeps Finance and the separately gated Payroll link. Finance section tabs hold the other tools. Existing ledger dialogs and CSV import remain available. Use Add an entry for receipt-first entry and Spending → Receipts and bookkeeping to tag an older/source-linked ledger entry.

Donations and grant instalments are ordinary manual income entries, tagged Donation or Grant, with the donor/funder as counterparty and a fund/cost centre/purpose. This preserves one ledger rather than creating another fundraising register. Cost centres track internal accounting only; an external event URL never creates a local event or contacts another product.

## Access and privacy

Owners/admins manage general finance. Members see it only when `financeVisibleToMembers`; guests never see it. Services re-read active membership, enabled account and workspace archive state, and filter tenant records by workspaceId. Foreign tags, profiles, files, accounts, source ids and approval ids never resolve.

Payroll has **no implicit access**, including for owners/admins. A workspace owner explicitly grants View or Manage payroll to active members. Owners can open the grant screen without a pay grant but cannot read salaries until granted. A payroll-only member can use Payroll without general finance visibility. `canViewPayroll` and `canManagePayroll` are pure helpers in `lib/roles.ts`.

Every returned pay profile/run, private detail reveal, payslip print, PDF generation, download and payroll CSV is audited before data is returned. PAN and bank references are encrypted separately with `finance-pay-pan` and `finance-pay-bank` purposes. The bank reference accepts only the last four digits and an IFSC; full account numbers are rejected. PAN/bank values are write-only while editing, with an explicit audited reveal that hides after 30 seconds or on tab concealment. Rates/salaries never enter general member profiles, global search, activity summaries, notifications or assistant output.

Individual payroll ledger postings carry `privatePayroll`. General ledger lists, direct entry lookups, general report rows, assistant finance summaries and workspace exports omit them. Cash/account/fund balances and budget actuals still include actual posted payroll payments; these are aggregate accounting totals. Payroll records and files require the explicit grant at download time, even for administrators and even after the generating user's grant is revoked.

Finance search documents are PRIVATE and owner-scoped. The shared search registry also rechecks live finance access and source existence. Payroll is never indexed. Activity and audit changes use generic messages and ids rather than copying private pay fields.

## Money and accounting semantics

All amounts are bounded integer minor units, paired with an ISO currency. Currencies are never added together. Bill and disbursement amounts are the **cash amount payable after any withholding**; taxable values, GST and TDS are separate manually entered facts, not automatic tax calculations. Payment forms accept the actual cash payment. Record statutory deposits as their own cash ledger expenses when paid. Payroll cost reports show gross plus allowances; posting a paid run creates the **net cash payment** expense. PF/ESI/PT/TDS summaries show entered deductions and do not calculate employer contributions or statutory deadlines.

Budget category/centre lines derive actuals from all matching non-void expense entries in the line's currency and full period. Legacy unscoped budgets retain explicit `budgetId` accounting. Reports show each budget line and its period separately, so monthly and annual lines can be reviewed without assuming that one replaces the other. Aggregate category/centre budget columns use lines whose periods exactly match the selected report period. Avoid overlapping planning lines when summing your own exports.

Fund balances are tagged income minus tagged expenses, including payroll cash postings. Unrestricted cash is total cash (including account opening balances) minus restricted fund balances. Opening balances are treated as unrestricted; record opening restricted funds as dated fund income rather than adding them again to an account opening balance.

Bill payments use a client-generated idempotency key checked against the full payment facts and serialize against the bill/finance lock. A retry cannot create another payment or expense; an overpayment is rejected. A payment can be recorded without posting when its expense is already logged. Paid bill facts remain immutable. Payroll approval requires a second payroll manager; paid runs can post once. Payroll managers can correct account/category/fund/cost-centre coding in an open period without changing the approved pay amounts. Disbursements use the existing CUSTOM approval subject and cannot be paid before approval. Advances store cumulative settlement and require proof, without posting a second expense. Team expense claims reuse Reimbursements in Requests; proof is required at submission and payment and the existing approved → paid flow supplies the ledger entry.

A workspace finance lock serializes period closing with payments, entry tagging and reconciliation. Reconciliation compares a manually entered statement balance against the opening balance plus all account movements through the statement date. Signing requires a zero difference and every entry marked. Account dates must follow the opening date. Month sign-off requires completed steps, spending review, all accounts reconciled and all entries assigned to accounts. Signed months/account ranges reject backdated edits through both new tools and the existing ledger/invoice/request posting paths. Reopening a month requires reopening later signed months first and invalidates its reconciliation sign-offs and spending review; audit history is retained.

## Receipts, PDFs and assistant extraction

`FinanceAttachment` links up to ten uploaded images/PDFs to a ledger entry, bill, fund, pay profile, pay run, disbursement or month. Each upload uses `uploadWorkspaceFile`, a 10 MB per-file/24 MB batch limit, the shared type allow-list and raster sanity checks. Drag/drop, file selection and a separate phone-camera input are provided. Images preview inline; PDF preview opens the authorised inline file route. Staged receipts use a separate id per form, belong only to their uploader and expire after 24 hours when unclaimed (legal hold and existing record references are honoured); confirming a record claims them atomically and cannot take someone else's upload. Private reserved folders and attachment relations exclude these files from the general library and its mutations.

`lib/files.ts` delegates finance record checks before every download. Missing owners, orphaned reserved-folder files, deleted files, suspended members, archived workspaces and revoked payroll grants fail closed. All file links use `/api/files/[id]`; no public object URLs or presigned bearer links are generated. Bill/disbursement/request proofs are inherited by their ledger entries in spending views.

Extraction is an explicit optional action. With no assistant key, the same form is blank. With a configured key, the first staged receipt is read from private storage and sent only to the configured Anthropic model via `lib/assistant/client.ts`; raster images are normalised locally, PDFs use base64 document input. The file is treated as untrusted content; JSON is validated and suggestions remain editable. Nothing reaches the ledger until the person confirms. The upload and final ledger record retain an extraction-used flag. Extraction errors preserve manual entry.

Paid payslips and saved report PDFs embed the app's Gilroy font, are stored through the same private upload service and link to their pay run/month. Printable HTML is also available. Report PDFs include summary tables and entry/receipt references. `pdf-lib` 1.17.1 and `@pdf-lib/fontkit` 1.1.1 are pinned dependencies. API request shapes were checked against the official [Anthropic PDF](https://platform.claude.com/docs/en/build-with-claude/pdf-support) and [vision](https://platform.claude.com/docs/en/build-with-claude/vision) documentation; PDF creation uses the [pdf-lib API](https://pdf-lib.js.org/docs/api/classes/pdfdocument).

## Reminders and limits

`lib/scheduled/financeTools.ts` is called by the existing finance scheduler. It sends generic personal notifications via `dispatch()` for overdue bills (daily), missing receipts (weekly, to the logger), upcoming month-end review and due disbursements. Transaction locks and audit markers deduplicate replica ticks. The existing ops-money budget scheduler uses the shared actuals calculation for 80% and 100% warnings. Sensitive data never goes to workspace routing destinations.

Lists paginate at 40 rows. Report/CSV reads reject periods above 20,000 entries; saved report PDFs ask for a shorter period above 2,000 entries. Possible duplicate pairs are review hints, limited to 200 pairs, not automatic deletions. Vendor+amount matches require the same currency and dates within seven days; invoice-number matches can span the selected period. Cross-month comparison includes a seven-day lookback. The main review compares the selected month with the preceding calendar month; custom report periods remain available.

`finance-tools.mjs` exports the normal async demo seed contract and adds Indian community-office funds, programme spending, unpaid and partly paid bills, a monthly budget/checklist, draft payroll and an advance. It is idempotent, uses invented people/references and intentionally leaves selected receipts missing to demonstrate the review; no fake proof is presented as an uploaded file. It grants demonstration payroll managers explicitly and does not set real PAN or bank details.

No external connector, bank parser, tax filing, automatic payroll calculation, donation-receipt issuance or public member payment system is simulated. There is no compliance calendar model in this checkout; statutory summaries link to the existing monthly checklist for manual deposit tracking.

## Shared files changed

Beyond the finance ownership row: schema plus one `finance_tools` migration; roles and payroll capability tests; nav/appShell for the separate payroll gate; crypto purposes; notification catalogue; authorised file policy/library reservations; search's live finance gates; assistant filtering; workspace export redaction; requests action/form/service and its existing approval-flow fixture for receipt enforcement; ops-money's budget actual calculation. These are required integrations, not new parallel systems. No README, deployment, release, Docker, main-checkout or other-worktree files are changed.

## Verification

Pure rules and PDF generation: `tests/unit/finance-tools-*.test.ts`. PostgreSQL/storage flows: `tests/integration/finance-tools-flow.db.test.ts`, plus the existing finance, files, approval and isolation suites. Coverage includes role forgery, suspension/archive state, tenant isolation, concurrent/idempotent payments, attachment ownership, optional extraction, search gates, threshold/reminder deduplication, encrypted pay fields, second-person approvals, audited views, revoked file access, net posting, advances and signed-period protection.

The requested lint, typecheck, unit/integration suites and production build are run for hand-off; `.next` is removed afterwards. Browser use is explicitly prohibited for this job, so 375px interaction and screen-reader checks require human review. The UI uses responsive stacked forms, bounded scrollable tables, 44px primitives, labelled fields, status words and keyboard-native disclosure controls. Generated PDF samples are rendered and inspected without a browser.

Shared-file inventory for review:

| Files outside the finance ownership row | Reason |
| --- | --- |
| `prisma/schema.prisma`, `prisma/migrations/20261020150000_finance_tools/migration.sql` | One appended finance schema extension, tenant cascades, composite tenant references and money/state checks |
| `lib/roles.ts`, `lib/nav.ts`, `lib/appShell.ts` | Explicit payroll capabilities and a grant-aware sidebar link |
| `lib/crypto.ts`, `lib/notify/events.ts` | Separate pay-field encryption purposes and typed finance reminders |
| `lib/files.ts`, `lib/files/service.ts`, `lib/files/versions.ts` | Record-authorised downloads and reserved private-library boundaries |
| `lib/search/query.ts`, `lib/assistant/tools/workspace.ts`, `lib/shell/export.ts` | Live finance search checks and payroll exclusions |
| `lib/requests/service.ts`, `app/w/[workspaceSlug]/requests/page.tsx`, `components/requests/OpsForm.tsx`, `tests/integration/ops-security.db.test.ts` | Reuse expense claims, require their proof, enable camera-compatible inputs, protect signed months and update the existing approval fixture |
| `lib/scheduled/opsMoney.ts` | Reuse category/cost-centre budget actuals in existing threshold alerts |
| `package.json`, `package-lock.json` | Pinned PDF/font embedding dependencies |

The required commit-message scan is empty. The repository-wide substring scan has pre-existing matches in the notes feature's model/client identifiers (already on `dev`); no finance code introduces those terms. Existing migration history and the notes feature are preserved. This is a baseline branding-scan exception, not a renamed or hidden finance dependency.
