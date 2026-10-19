# App reviews implementation

The area owns the inbox, review detail/composer, insights and admin settings
under `/w/[workspaceSlug]/app-reviews`, the Slack event endpoint,
`app/actions/appReviews.ts`, `lib/appReviews/`, `components/appReviews/`,
`lib/scheduled/appReviews.ts`, its tests, seed and setup documentation.
See [setup and operations](../APP_REVIEWS.md).

One `app_reviews` migration appends accounts, apps, reviews, attempts, Slack
configuration, inbound queue and explicit Slack/member mappings. Composite
foreign keys enforce tenant and platform agreement. Tenant relations cascade,
indexes start with workspaceId, and rating/poll-interval checks are enforced
in PostgreSQL. Secrets have separate encryption purposes per column and never
appear in settings projections, assistant output, audit metadata or errors.

Ingest INSERT and notification dispatch share a transaction; a duplicate
review only updates content and its search record. Poll leases use an atomic
conditional UPDATE and token-checked renewal/release. Only a completed sync
advances the pagination boundary, so a partially saved first sync is retried
without dropping older reviews. Reply attempts are
permanent trigger claims under a review row lock; a send is never repeated
automatically. Reconciliation reads store responses and checks the latest
attempt under that lock before updating state. Slack events are queued before
acknowledgement and deduplicated by workspace/event ID; the store trigger is
also unique by channel/message, so a second event ID cannot repeat the reply.

Create task locks the review and creates its task/link atomically. It honours
private-team project access, uses the workspace task counter, assigns the
task to the creator, and writes task history, search, activity and audit data.
This is an intentional cross-area write for the requested action; no task
service source files are changed.

Shared integration edits required by the task: schema/migration and ownership
row; roles and Operations navigation; encryption purposes; notification event
catalogue, reviewed-app scope and rating filter; scheduled-job registration;
read-only assistant-tool registration and API token scope. `undici` is pinned
for ProxyAgent support. No deployment or other area UI files are changed.

The generic DestinationPicker component is not present in this checkout.
App settings use `listPickableDestinations`, `getScopedDestinationIds` and
`setScopedDestinations` with accessible labelled checkboxes. Shared destination
provider adapters remain owned by integrations-messaging; their existing
configuration status determines routed delivery. The optional app-specific
Slack mirror and reply transport is implemented here.

Demo seed exports one async function using the shared loader contract. Its two
apps/accounts remain paused without real credentials, with eight reviews
covering triage, versions, languages, replies and rating distribution. It
does not contact stores or Slack.

Verification is in `tests/unit/app-reviews-*.test.ts` and
`tests/integration/app-reviews-*.db.test.ts`. Store and Slack fetches are mocked;
integration tests default to rejecting any unexpected fetch. JWT signatures
are verified with generated keys; fixtures contain only invented review data.
