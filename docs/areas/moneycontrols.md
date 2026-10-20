# Money and asset controls

These are manual internal office tools. They extend the merged finance accounts, funds, ledger, payroll permissions, approvals, asset register, onboarding/offboarding checklists and governance calendar. They do not connect to banks, accounting systems or TRACES, calculate statutory tax liability, or manage public lending or payments.

## Screens

The sidebar has one admin-only **Money controls** entry at `/w/[workspaceSlug]/money-controls`. Four section tabs lead to `/money-controls/cash`, `/assets`, `/tds` and `/funds`. Finance has a link to the tools; the existing equipment page links to assignments and the schedule. Every page resolves current workspace membership itself. Members can open only their own IT assignments and incoming/outgoing custodian handovers, through the equipment link or a personal reminder. General finance visibility does not grant access to these detailed registers.

Each screen has a filtered, paginated list, owners, dates, optional due/review date and reminder lead time, notes, multiple private proofs, an append-only action history and CSV export. Filters include type, status, owner and record dates. The main empty state uses Patch and one action. Forms stack on narrow screens; schedule tables scroll within a keyboard-focusable, labelled region. Shared brand controls provide labels, validation feedback, pending states and status words. Loading and error boundaries cover all tools. Browser execution is explicitly prohibited for this job, so a human still needs to verify the 375px interaction and screen-reader experience.

### Petty cash, transfers and deposits

Create bank/cash accounts in Finance → Month-end, then designate a cash account with a target float and custodian. A float is a target; it never adds another opening balance. Vouchers get a workspace sequence (`CV-00001`) when saved, including cancelled drafts. Confirming requires a real receipt/proof, an available cash balance and an open financial period. The confirmation posts one linked expense, under the finance lock. Its source amount cannot be edited or voided through the ordinary ledger. Multiple proofs remain with the voucher and are inherited by the spending review; a restricted finance viewer gets only a proof-present flag, not private filenames.

A count accepts denominations and quantities in the account's currency, for example `500=2,100=3,0.50=4`. Confirmation freezes the counted amount, expected account balance, difference, counter and explanation. A non-zero difference requires notes. It does not silently create an adjustment entry.

A replenishment request uses the existing CUSTOM approval subject and Requests inbox. Its saved amount/accounts are locked while pending; a rejected request can be requested again through the existing engine. An approved replenishment records equal and opposite account movements, rather than income or expense. An inter-account transfer does the same, with accounts in the same currency. It cannot transfer to itself. No exchange-rate tool is introduced.

A custodian handover records the cash handed over. The current outgoing custodian signs first, retaining the expected balance and any explained difference. The incoming custodian signs second; this updates the float's custodian. Admin status does not substitute for either signature. A changed account balance or custodian invalidates completion: cancel and record a fresh handover/count. These are internal sign-offs, not statutory digital signatures.

Security deposits record given/received, counterparty, account, amount and expected return date. Confirmation moves cash without creating revenue or expense. Partial returns keep the original amount, cumulative returns, individual movements and outstanding balance. Over-returns fail; deposits and movements cannot be edited after confirmation. Add corrected evidence with notes rather than replacing confirmed proof.

Transfers, replenishments and deposits use `MoneyControlMovement`. The existing account-balance and fund cash-summary calculations include these movements. They remain outside ledger income/expense, budgets and fund utilisation. Cash controls exposes each movement's reconciliation action; existing account sign-off refuses unmarked movements, and signed periods/account ranges reject backdated movements. Retrying an operation with the same key and facts posts once; reusing the key for different facts is rejected. Existing financial opening dates and period locks apply.

### Assets and depreciation

The existing Asset is the equipment identity. A depreciation category stores editable SLM/WDV, useful life, annual WDV percentage, residual amount and accountant-reviewed Income-tax block/rate notes. A fixed-asset record links the Asset, purchase date/cost/currency, optional fund and funding-source note, category and purchase evidence. Confirmation updates the existing purchase fields. Its depreciation basis is captured when saved; changing a category does not rewrite a confirmed schedule.

The FY selector shows original cost, opening book value, depreciation, disposal book value and closing value. The internal book schedule uses daily proration over the actual April–March year, rounds once per year to the nearest minor unit and preserves the residual floor. SLM uses original depreciable cost/useful life; WDV uses opening value and the entered rate. It stops charging on disposal and removes the remaining book value. This is a book schedule, not a statutory block depreciation or tax computation. [Income Tax Department depreciation rates](https://www.incometaxindia.gov.in/w/depreciation-rates) describe separate block/WDV rates; no changing statutory rates are hard-coded here.

Verification records retain date, verifier, condition and photos/PDF evidence, and update the register's condition. Disposal supports sale, scrap or donation, evidence and proceeds. Assigned equipment must be returned first. Sale proceeds post once as linked income; scrap/donation use zero proceeds. Disposal retires the existing Asset, and the normal asset editor cannot reactivate a disposed item or bypass evidence for an asset with a fixed-asset schedule. Asset row locks coordinate these mutations with the existing register.

IT issue/return history is per Asset and person. Confirming an assignment requires available, unassigned equipment and an active workspace member. The person can acknowledge receipt. Return records date, reference, condition and the returning administrator, then clears the current Asset owner. The existing offboarding source reader therefore finds active assignments automatically. A record can also link the person's tenant-checked onboarding or offboarding checklist. Checklists remain managed by the existing people tool.

### TDS register and filing history

Log TDS deducted by us with payee, manual section/local withholding code, gross payment, withheld amount, date, FY and quarter. The date must match the selected FY/quarter, and withholding cannot exceed gross payment. Certificates record received/issued, official form name and number, payee, period, optional delivery date and matched deduction. A linked certificate must match its payee, section, currency, confidentiality and quarter. Recording it requires an uploaded PDF. The application does not generate or certify an official TRACES document. [TRACES certificate guidance](https://traces61contents.tdscpc.gov.in/en/faq-dedu-form16-download.html) describes downloading official certificates; current local form names remain manually editable.

Quarterly returns retain prepared → submitted → accepted → paid as distinct manual states. Each later state requires uploaded proof and an acknowledgement/payment reference, with actor/date/history retained. Records can link an active obligation in the merged governance compliance calendar. Due dates and reminders are entered manually; there is no hard-coded statutory deadline engine.

Salary-related deductions/certificates/filings use the explicit payroll flag. Section 192 and an exact Form 16 name also force payroll privacy. Explicit View/Manage payroll grants apply even to owners/admins. Payroll confidentiality cannot be removed once selected. Payroll records/proof filenames are never indexed; reads, exports and private file downloads are audited. File rights are rechecked after grant revocation. Use the payroll flag for any equivalent current or international salary form; automatic recognition is only a convenience, not a classification service.

### Restricted funds

A restriction record extends an existing FinanceFund, including a grant represented by that fund. It stores eligible start/end dates, total eligible amount, allowed expense categories (empty means all), and independent **Block**/**Warn** settings for eligibility, budget and duplicate references. Currency must match the fund. Configure these facts from the agreement; existing fund notes alone are not parsed into rules.

The existing finance write paths call `checkFundRecord` under the existing workspace finance lock, after mutation and before commit. This covers new expenses, entry recoding and legacy edits/restores, bills and payments, payroll runs/coding/transitions and disbursements. A blocked write rolls back its financial changes. Warnings retain generic audit entries and are shown on the finance tool form and fund review screen.

The live calculation combines posted non-void expenses with unpaid bill balances, unposted net pay runs and unpaid disbursements. A derived posting replaces its reservation, so bill part-payments, payroll and disbursements are counted once. Payroll follows the merged finance tool's **net cash** basis; the utilisation statement is cash utilisation, not a gross salary cost or statutory utilisation certificate. Actual expense dates/categories/currency are checked, and outstanding commitments remain visible even when ineligible.

Duplicate checks compare the same counterparty/invoice reference across funds; source-backed pay/disbursement records have stable identities. Keep references consistent when logging the same external proof. This does not attempt image matching or infer that two manually entered descriptions are the same expense. The fund screen and CSV show budget, committed/posted total, remaining eligible amount, warnings and actual income/expense by category/currency. Salary detail remains absent; aggregate cash use includes authorised payroll postings. Rule changes expose any pre-existing violations for review without rewriting historical entries.

## Permissions, storage and integration

`MoneyControlRecord` holds common typed money/date/status/owner fields and strictly validated kind-specific JSON. `MoneyControlAttachment`, `MoneyControlMovement` and `MoneyControlEvent` supply proof, cash and history. The single migration is `20261020232000_moneycontrols`. New models are appended at the end of the schema, cascade with their Workspace, and have tenant-leading indexes/composite record/file relations. The migration reuses existing `FileObject_workspaceId_id_key`; it does not recreate it. Account movements also have a composite account/tenant foreign key and nonzero-money checks. Record references to existing assets, funds, categories, accounts, people, checklists and obligations are resolved within the workspace before saving and rechecked before confirmation.

Services re-read active membership, disabled-user and archived-workspace state. The server resolves the workspace from the slug; it never trusts a client workspace ID. General control changes require `canManageMoneyControls`; personal acknowledgements/signatures require the actual person. `canReadMoneyControl` is covered by pure capability tests. Money uses bounded integer minor units and ISO currency throughout.

Proofs use only `uploadWorkspaceFile` and the existing private object store/authorised `/api/files/[id]` route. Up to twenty files are retained per record; a batch accepts ten files, 10 MB each/24 MB total, under the shared image/PDF allow-list and image decode checks. The UI supports multi-select, drag/drop, phone camera, image preview and authorised PDF preview/download. A failed batch rolls back its rows and removes written objects. Files live under reserved `/money-controls`, stay out of the general library and its mutation/trash APIs, and remain linked to their original record. Orphaned reserved-folder files fail closed. Draft proof can be removed; confirmed evidence is append-only. A record's current permissions, including explicit payroll grants, are checked at download time.

Non-payroll records index titles only as PRIVATE/owner-scoped. The search registry and assistant recheck live source access; assistant jobs/tokens cannot recover these private records. Activity is generic and source-gated. `lib/scheduled/moneyControls.ts` sends generic personal `moneycontrols.reminder` events through dispatch. Persisted claims and advisory locks deduplicate replica ticks; current owners/participants must still have access, and payroll recipients must still have a grant. No private title, amount, certificate body or salary is routed to workspace destinations.

CSV reads use the same filters/current access, neutralise spreadsheet formula prefixes, quote multiline values, include proof references and action history, and return private/no-store responses. Lists paginate at 40 records; exports reject more than 10,000 records. The standard `scripts/seed/moneycontrols.mjs` export adds idempotent Indian NGO-office draft examples and reviewed-rule prompts. It does not invent uploaded evidence or present demo drafts as issued certificates. No dependencies were added.

## Files outside the original ownership row

The user explicitly authorises shared integrations needed for this feature. These are the changes beyond new money-control routes/actions/components/services/tests/seed/docs:

| Files | Reason |
| --- | --- |
| `prisma/schema.prisma`, `prisma/migrations/20261020232000_moneycontrols/migration.sql` | Appended controls, private attachments, movements and history; tenant/amount constraints |
| `lib/db.ts` | Explicit constructor options type avoids a costly whole-client generic comparison after expanding Prisma models; runtime configuration is unchanged |
| `lib/roles.ts`, `lib/nav.ts` | Capabilities and one calm sidebar entry |
| `lib/notify/events.ts`, `lib/scheduled/index.ts` | Typed personal reminders and scheduler registration |
| `lib/files.ts`, `lib/files/service.ts`, `lib/files/versions.ts` | Record-authorised downloads and reserved-library boundaries |
| `lib/search/query.ts`, `lib/assistant/tools/workspace.ts` | Live source checks, private payroll exclusions and job/token restrictions |
| `lib/finance/service.ts`, `lib/finance/tools/service.ts` | Fund validation in existing mutations and safe rule errors |
| `lib/finance/tools/close.ts`, `lib/finance/tools/queries.ts` | Account movements, reconciliation locks, cash summaries and inherited receipt proofs |
| `app/actions/finance-tools.ts`, `components/finance/ToolForm.tsx`, `components/finance/FinanceTabs.tsx` | Reviewable fund warnings and tool navigation |
| `lib/scheduled/financeTools.ts` | Avoid asking for a cash voucher receipt already retained with its source |
| `lib/assets/service.ts`, `app/w/[workspaceSlug]/assets/page.tsx` | Preserve disposal evidence/lifecycle and expose assignments beside existing equipment |
| `frontend/catalog.json`, generated frontend contracts/model/page metadata, `lib/frontend/*`, `lib/views/generated/*` | Required private-gateway catalogue/types after new pages/actions |

No README, deployment/release files, other worktrees, main checkout, Docker or browsers are changed or used. Changes remain uncommitted, as required by the area instruction. The sandbox rejected renaming the starting `feat/moneycontrols` worktree branch to `feat/money-controls`; work continues on the original branch.

## Verification and limits

Unit coverage: role gates and personal access, denominations, currencies, FY/quarter boundaries, calendar validity, SLM/WDV/proration/residual/disposal, fund modes and safe CSV. PostgreSQL/Silo coverage: current roles and tenancy, voucher numbering/idempotency, transfer/deposit accounting, reconciliation and period guards, counts, approval-backed replenishment, dual handovers, private files, IT issue/offboarding/return/disposal, category snapshots/verification, official certificate matching and filing history, revoked payroll downloads, concurrent fund limits, bill reservation replacement, duplicate references, payroll/disbursement commitments, recoding, search, reminder deduplication, action/export guards and workspace cascades.

The required repository branding scan has 31 inherited substring matches in the pre-existing notes model and callers. The commit-message scan is empty. This feature adds no such terms and preserves historical migrations. The final check totals and baseline comparison are recorded at hand-off. Browser/mobile visual and assistive-technology checks were not run, as explicitly instructed. Statutory tax calculation, official issuance and external integrations are deliberately outside this manual tool's scope; none is simulated.

Suggested logical commits: `feat(money-controls): add tenant-scoped controls and accounting hooks`; `feat(money-controls): add manual tools and private evidence`; `test(money-controls): cover controls and document office workflows`. No commits, pushes or merges are made in this task.


## Final verification totals

- Lint: pass with `--max-warnings=0`. Backend and frontend typechecks: pass with the requested 4 GB heap. Production build: pass; the verified worktree `.next` directory was removed afterwards. The command guard rejected the broad cleanup form, so cleanup used a checked, fixed build-directory path.
- Unit suite: **1,020 passed**, one inherited skipped test, 73 files (`--maxWorkers=1` to bound memory). Money-control pure cases: 22.
- PostgreSQL/private Silo integration suite: **435 passed**, 42 files. Money-control cases: 20. The full suite used 60-second case/hook limits under shared-host memory pressure; no cases were omitted.
- Requested databases: migration deployed to `sww_ops`; `sww_ops_test` prepared with all 12 migrations and no pending migration. The local task service overrides point to the requested databases, Redis DB 13, private Silo bucket and port 3440; existing environment content was not read.
- Demo seed checked twice: 14 records both times, with voucher number/counter remaining 1. Temporary verification workspaces/users and test objects were removed.
- Frontend catalogue: 193 guarded views and 287 actions; generated catalogue check passes; zero obsolete generated view modules.
- Commit-message branding scan: zero matches. Repository scan: 31 inherited matches, identical to the starting commit. All new files and added diff lines: zero matches. `git diff --check` passes.
- No features are stubbed. Mobile/browser/assistive-technology interaction was not run because browser execution is prohibited for this job. No commits, pushes or merges were made.
