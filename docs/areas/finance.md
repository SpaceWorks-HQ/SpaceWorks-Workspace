# Finance

Finance lives at `/w/[workspaceSlug]/finance`: summary, ledger, categories,
CSV import/export and invoices. Every page checks membership itself and uses
`canViewFinance`; only owners/admins mutate through `canManageFinance`.
Guests never see finance. Members need `financeVisibleToMembers`.

Amounts are integer minor units, formatted using the record's currency (INR
by default). Single amounts and invoice totals are capped at 2,147,483,647,
the existing schema's signed integer limit. Totals never combine currencies.
Ledger filters cover date range, description/payee/category, type, category
and void state. Running balances use the full ledger, independent of filters.
Source-linked entries keep their money facts and source identifiers; admins
can edit bookkeeping fields. Void changes go through the source record.
Receipts use the private upload service and retain finance download checks.

CSV import previews every row and revalidates the original file on commit.
It accepts up to 1 MB and 1,000 rows. Dates, currencies, category type and
archive state, positive amounts, quoting and headers are checked. Export
neutralises spreadsheet formulas and exports at most 20,000 matching entries.
Exports over 20,000 matching entries return a clear error asking for narrower
filters rather than silently omitting entries. Importing the same file twice intentionally creates two batches; it is not a
bank reconciliation or duplicate detection service.

Invoices use the workspace invoice counter. Drafts and sent invoices may be
edited; sent invoices can be paid, and drafts/sent/paid invoices can be voided.
Payment locks the invoice before reading its total, commits one uniquely
source-linked income entry, and is idempotent under retries/concurrent calls.
Voiding a paid invoice also voids its income. Finance changes add private, generic activity records. The shared visibility
enum has no finance/admin gate, so invoice details are not copied to global
search or activity. A finance-aware global search policy is a coordinator gap.
Print pages have paper CSS. Invoice email is queued through `enqueueEmail`
inside the transaction; “Email again” deliberately queues another copy.
Actual delivery and retry policy belong to the existing outbox worker.

Invoice lists paginate in groups of 50. Finance routes have accessible loading
messages and retry boundaries. `lib/scheduled/finance.ts` emits `invoice.overdue`
once per invoice due date using a row lock and audit marker. Due dates use
workspace midnight; workspace rules select notification destinations.

Demo data: `scripts/seed/finance.mjs` adds ledger history and invoice states.
Tests: `tests/unit/finance-rules.test.ts`, `tests/integration/finance.db.test.ts`
and `tests/e2e/finance-pages.spec.ts` (request-only renderer checks).
