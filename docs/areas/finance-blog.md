# Finance and blog

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

Invoice and CMS lists paginate in groups of 50. Finance and CMS routes have
accessible loading messages and retry boundaries. Public error pages offer a
retry; public reads finish their visibility checks before rendering to retain
404 responses for hidden content.

The CMS is `/w/[workspaceSlug]/blog`, restricted to owners/admins. It includes
status filters, a tiptap editor, server-side sanitisation, unique slugs,
excerpt, cover upload, SEO length hints, preview, publish/unpublish, schedule
and delete. Preview shows saved content and is excluded from indexing.
Scheduled posts are drafts with a `publishedAt`; public queries always need
`PUBLISHED`, a non-future publication date, an enabled blog and an active
workspace. Due drafts are claimed with conditional updates, and published
posts are added to search/activity. Unpublishing removes the search record.
Live and scheduled posts must retain a text body; unpublish before clearing it.
Publishing, scheduling and cover changes lock the post to serialize competing
edits. Receipt edits use the entry revision and roll back the file row and
remove the stored object if another edit or void wins the race.

Public routes are `/blog/[workspaceSlug]` (10 posts per page),
`/blog/[workspaceSlug]/[postSlug]`, `rss.xml`, `sitemap.xml`, and each post's
`cover` subroute. Pages include canonical, OpenGraph and Twitter metadata.
The public cover route only exposes that published post's undeleted raster
cover from `/blog/covers` in the same workspace, without doc/task/receipt/chat
links. It accepts no arbitrary file id. Public file/XML responses use
`no-store` so disabled/unpublished content is checked on every request.
The general `/api/files` route remains authenticated. RSS includes the latest
50 posts. The sitemap selects only addresses and timestamps, and automatically
returns a sitemap index with `?page=N` partitions above 49,999 posts.

`lib/scheduled/financeBlog.ts` runs through the existing scheduler registry.
It publishes due drafts in batches of 50 and emits `invoice.overdue` through
`dispatch`, once per invoice due date. Due dates use workspace local midnight.
An invoice row lock and an audit marker prevent duplicate overdue events
across replicas. Workspace notification rules choose delivery destinations;
there is no invoice-specific routing scope in the shared catalogue.

Demo data is registered in `scripts/seed/finance-blog.mjs`, extending the
core demo ledger with history, invoice states and published/draft/scheduled
posts. It respects settings owned by the core seed. No schema changes,
new dependencies or shared-core edits are required.

Tests: `tests/unit/finance-blog-rules.test.ts` and
`tests/integration/finance-blog-{finance,public}.db.test.ts`. Integration tests
use real PostgreSQL and private storage; auth sessions, revalidation and
request rate limiting are controlled so role/tenant checks remain real.

`tests/e2e/finance-blog-pages.spec.ts` uses Playwright's request fixture (no
browser process) against a running Next server. It creates and removes its
own workspace, checks rendered controls and rejects streamed rendering errors,
and verifies metadata, feeds, draft 404s and disabled-blog 404s. Load local
environment variables when invoking it so Prisma uses the feature database.
Visual inspection at 375px still requires a browser; these request tests do
not verify layout or client interactions.
