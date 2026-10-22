# Rent and recurring costs

Internal manual tools under Finance. These extend supplier bills, bill payments, payroll, the lease and insurance registers, and Money controls. There are no external connectors, bank parsers or payroll calculations.

`/finance/recurring` holds rent, utility estimates, maintenance, software, insurance and loan/EMI schedules. Each has a payee, optional CRM contact/organisation, amount/currency, monthly/quarterly/yearly frequency, due day, start/end, lead/reminder days, owner, category, fund, cost centre, payment account, manually reviewed GST and withholding rates, notes and private evidence. Source shortcuts copy an active lease, subscription or insurance premium into an editable schedule. Schedule changes affect future bills; generated dues retain their facts. Timing, currency, loan principal and withholding section cannot change after generation: pause and replace the schedule. Lease and insurance links are unique within a workspace.

The scheduler persists the next due date and creates ordinary FinanceBill records once per schedule/date, under the existing finance transaction lock. A tenant/source unique key protects retries. It catches up at most 120 periods per schedule per tick and resumes from its saved cursor. Month-end days clamp without losing the original due day. End dates and loan tenure stop generation. Invalid/archived accounting defaults or a blocked fund pause the affected schedule, retain an audit reason and notify managers without preventing other schedules from generating. Ended leases and unavailable/cancelled insurance pause their schedules. Generation creates commitments, not cash entries. Estimated utility bills carry Needs actual amount and cannot be paid until confirmed. Bills with a planned GST rate also require invoice review: enter actual CGST/SGST or IGST components before payment. The schedule never infers a place of supply or a tax component from a percentage. Each resulting bill retains the normal partial-payment, idempotency, private receipt, fund control and closed-period protections.

`/finance/dues` shows overdue items first and then 30/60/90 days of unpaid bills, recurring dues and staff recoveries. Future occurrences outside the generation lead window are clearly marked Projected and are calculated without issuing bills. Filters cover type, text, fund, cost centre, currency and payment status. CSV exports use the same current access and filters, quote multiline text and neutralise formulas. Fixed monthly cash burn stays separate by currency, fund and cost centre and excludes estimates. The list also shows each schedule's base monthly equivalent and overdue bill count.

The existing Facilities lease page now shows the dated rent ledger, every paid date, receipts, withholding and outstanding cash, plus the linked Money controls security deposit. Record deposit cash and partial refunds in the existing deposit tool; the lease shows amount/date, refundable status and refund history. Deposits stay outside expense reports. The schedule retains proposed renewal escalation and a renewal reminder; agreeing and entering a new rent remains manual. No automatic escalation rewrites bills.

Paid payroll runs create PF, ESI, professional-tax and salary-withholding bills from their existing deductions in the same PAY transaction. Beat also catches up previously paid runs, once per run/kind. `/finance/payroll/dues` requires explicit payroll access, including for owners/admins. PF/ESI default to the 15th and salary TDS to the 7th of the following month; PT uses a plain 15th default. Each unpaid remittance has an editable reviewed due date for state/jurisdiction exceptions. These are editable planning defaults supplied by the feature specification, not an applicability determination. Challan proof is required before payment; the existing bill payment retains paid date/reference and posts a private payroll expense. General bill lists, CSV, conflict pickers and search exclude these records. Explicit grants are checked again for payment and every file download.

`/finance/advances` holds private salary advances and staff loans. Explicit payroll managers create a record against an existing member-linked pay profile, then request an independent payroll manager's approval through the existing CUSTOM approvals engine. Approval inbox titles contain no person, amount or reason. Payout rechecks the actual approving person's current grant, requires proof and creates a cash-only deposit movement. Instalments divide every minor unit exactly. Manual repayments move cash back; allocations against a paid pay run consume only its entered advance deduction, without a second cash posting. Persistent operation facts reject conflicting retries and over-recovery. Action capability checks run before profile/bill currency resolution or amount parsing; a missing and an inaccessible private id produce the same refusal. People can read only their own records/proofs; explicit payroll managers can read all. Staff records and files never enter global search or general activity. Reads/exports/downloads are audited.

EMIs retain manually entered lender, original principal, annual reference rate, amount and tenure. Each generated bill needs a confirmed principal/interest split. Payment allocates principal proportionately (including partial payments) to existing cash-only movements and posts only interest as expense. Monthly cash flow includes principal, deposits and aggregate payroll cash without exposing personal lines; internal transfers are excluded. Income/expense tables retain their expense basis. Outstanding principal derives from paid bill principal, with allocation bounded by original principal. The loan rate does not calculate amortisation. Recording loan proceeds/opening balances remains a manual Finance account operation; the schedule itself adds no cash. Rent/other withholding creates an idempotent existing Money controls TDS_DEDUCTION record when the bill is fully settled, with section, gross, FY and quarter. Tax filing/payment remains in the existing register.

All evidence uses FinanceAttachment → uploadWorkspaceFile → private Silo/S3 and `/api/files/[id]`. Schedule, bill/challan and advance forms reuse multiple-file selection, drag/drop, phone camera and image/PDF preview, with existing 10 MB/file, ten-file and 24 MB/batch limits. The reserved finance folders stay out of the general library. Schedule files require finance management; remittance files require explicit payroll access; advance files also permit the person. No bytes are stored in the database, local files or data URLs by this feature.

`lib/scheduled/recurringCosts.ts` is registered with the existing worker/beat. Generic personal due/overdue and rent-renewal reminders use dispatch with workspace routing disabled. Persistent event claims under the finance lock deduplicate replica ticks. Current active administrators receive general dues; current payroll managers receive private remittances; recovery reminders include the active person. Reminder bodies contain no amounts, titles, salaries or proof names. General schedule titles are PRIVATE/owner-scoped search documents, with live admin/source checks; assistant jobs and API tokens cannot use them.

Lists show 40 schedules, dues or advances per page. Exports cap at 10,000 source rows. Advances filter by reason, person and status, with the same personal/payroll-manager boundary. Payroll deadline applicability, tax rates, loan splits, proof correctness, repayments and renewal agreements remain manual. No filing, connector or statutory calculation is simulated.

## Schema and shared integrations

One appended migration: `20261021014000_recurring_costs`. New tenant-cascading models are RecurringCostSchedule, RecurringCostDue, StaffAdvance and StaffAdvanceRecovery. FinanceBill gains needsActual/privatePayroll flags and its due relation. All new unique/index prefixes start with workspaceId. The migration reuses existing composite bill/workspace keys and does not duplicate an earlier unique-index name.

Outside Finance ownership: schema/migration; roles/nav; notify catalogue and scheduler registry; search/assistant live gates; Facilities lease page; governance insurance premium frequency; Money controls deposit refundable status, protected generated cash records and private reconciliation checks; conflict pickers excluding payroll bills; generated frontend catalogue/contracts/views. These changes connect existing records and protect their permissions. No dependencies, README, deployment/release files, browser, Docker, other worktree or main-checkout changes are made.

Demo data in `scripts/seed/recurring-costs.mjs` includes ₹45,000 rent, ₹1,35,000 refundable deposit, 5% proposed escalation, utility estimate, ₹1,500 broadband, quarterly fire-extinguisher AMC, a paid run with four remittances, ₹20,000 advance over four months with one recovery, ₹3,00,000 equipment principal/EMI and yearly fire insurance. Seed data is repeatable and uses invented references; uploaded proofs are deliberately absent.

## Verification and review groups

Pure tests cover capabilities, dates, clamping, tax arithmetic, rounding, instalments, remittance defaults, validation and CSV safety. PostgreSQL/private-storage tests cover generation races, payment retries, actual-amount gates, EMI accounting, source reuse, tax records, paid-payroll triggers, statutory privacy, revoked grants, advance approval/cash/recovery, search/download checks, reminder dedupe, action/export authorization, and suspension/archive checks. Browser execution is prohibited; interactive 375px and assistive-technology review is therefore not performed. Forms stack at narrow widths and use shared labelled controls, keyboard-native disclosures, status words and Patch empty states.

Changes remain uncommitted. Suggested logical review groups (with both user-requested co-author trailers when committed):

1. `feat(finance): add recurring schedules and tenant-scoped dues` — schema/migration, domain rules/services, worker/reminders, source links, cash/withholding integration and privacy gates.
2. `feat(finance): add recurring tools, lease ledger and private advances` — routes, forms/lists, CSV, proof controls, navigation and regenerated frontend contracts/readers.
3. `test(finance): cover recurring costs and document manual workflows` — unit/integration coverage, repeatable seed and this contract.

Final verification totals and inherited repository constraints are recorded at handoff.

Shared-file inventory outside the Finance ownership row:

| Files | Purpose |
| --- | --- |
| `prisma/schema.prisma`, `prisma/migrations/20261021014000_recurring_costs/migration.sql` | Tenant models, bill flags, amount/date checks and the existing attachment-type allow-list extension |
| `lib/roles.ts`, `lib/nav.ts` | Recurring-cost and personal-advance capabilities; discoverable staff advances |
| `lib/notify/events.ts`, `lib/scheduled/index.ts` | Typed personal reminders and worker/beat registration |
| `lib/search/query.ts`, `lib/assistant/tools/workspace.ts` | Live schedule access checks and restricted machine/job searches |
| `app/w/[workspaceSlug]/safety/facilities/page.tsx` | Load and show the lease's rent ledger and linked deposit |
| `components/governance/Screen.tsx`, `lib/governance/fields.ts`, `lib/governance/schemas.ts` | Insurance premium frequency and a source-to-schedule action |
| `lib/govextras/conflicts.ts` | Exclude private remittances from general bill conflict pickers |
| `lib/moneyControls/access.ts`, `lib/moneyControls/service.ts` | Protect generated principal/advance cash records and payroll movement reconciliation |
| `lib/moneyControls/rules.ts`, `components/moneyControls/fields.ts` | Refundable security-deposit facts |
| `lib/moneyControls/funds.ts` | Retain payroll confidentiality on remittance commitments |
| `frontend/catalog.json`, `frontend/contracts.d.ts`, `frontend/model-types.d.ts`, `frontend/model-types.json`, `frontend/pages.json`, `lib/frontend/registry.ts`, `lib/frontend/resources.ts`, `lib/views/generated/*` | Required guarded view/action catalogue, transport types and updated Facilities reader |

The shared file route already delegates all FinanceAttachment authorization to `lib/finance/tools/files.ts` → `recordAccess`. Extending that existing adapter covers new schedule/advance types and payroll bills, so no parallel file route or storage policy is introduced.

The local draft migration was extended with its exact additive constraint delta in both assigned databases. Only this unpublished draft's checksum was synchronised to the final SQL; application records were retained. Deploy and test preparation then reported all sixteen migrations applied and none pending. A fresh deployment uses the single complete migration file.


## Final verification, 21 October 2026

- `npm run db:deploy` and `npm run db:test:prepare`: pass; all sixteen migrations are applied in the assigned databases.
- Lint: pass with zero warnings. Root and frontend typechecks: pass with the requested 4 GB heap limit. The final root typecheck writes the normal Next build-cache location so the production build can reuse the same checked source.
- Frontend catalogue: 210 guarded readers and 302 actions; 512 transport types and 41 shared UI types. Zero stale generated readers; the database/render boundary check passes.
- Unit suite: 79 files; **1,125 passed**, one inherited skipped test. Recurring-cost pure cases: 22.
- Full PostgreSQL/private Silo integration: 49 files; **534 passed**. Recurring-cost cases: 22, including authorization before private identifier resolution and payroll-only manager access.
- Production build: pass. Root/frontend `.next` output and the task's lint cache were removed afterwards. `git diff --check` passes.
- Seed run twice: six schedules, ten dues and four recovery instalments both times; the temporary workspace and user were removed. New unique index names have no earlier migration collisions.
- Commit-message branding scan: zero matches. Tracked-tree scan: **31 inherited substring matches**, exactly the starting baseline, in the existing notes identifiers/migration. New files and added diff lines have zero matches. The strict repository-wide grep therefore remains an inherited failing gate; historical migrations and unrelated identifiers were preserved.
- Branch `feat/recurring-costs` has no feature commits and remains uncommitted. `dev` is 8 commits ahead at handoff. Rebase was rejected because the sandbox cannot create the protected worktree Git index lock. Verification applies to this worktree's base; integration with current `dev` needs a rebase, catalogue refresh and another verification run.
- No features are stubbed. Browser, interactive 375px and screen-reader checks were not run, as browser execution is prohibited. No Docker, push, merge, README or deployment/release changes were made.
