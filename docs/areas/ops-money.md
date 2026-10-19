# Operations and money

Space Works operations live at `/w/:workspaceSlug/requests`, `/catalogue`,
`/subscriptions`, `/vault`, `/assets` and `/forms`. Every page resolves active
workspace membership itself. Guests cannot access these areas. Services recheck
membership, disabled accounts and archived workspaces before writes.

## Requests, budgets and approvals

Members submit purchases and reimbursements with an amount in minor units,
currency, vendor, justification, an optional matching-currency budget and up to
ten receipts (10 MB each, 24 MB combined). Receipts use `uploadWorkspaceFile` and the shared private file
endpoint. Members see their own requests and requests they are eligible to
review; admins see all workspace requests. Budget totals follow finance
visibility. Expenses exclude voided rows and respect the budget's date range.

Approval steps name a role, person, team or team lead. Roles include higher
roles. Steps run sequentially, require distinct people and exclude the
requester. Disabled and suspended people cannot approve. Missing people do not
lower quorum or widen authority. Such requests remain pending until the
required people are available. Amount thresholds apply in the request currency;
a request below every configured threshold is approved automatically. Without
a policy, one admin or owner must approve.

A rejection ends the request. Requesting changes returns a money request to a
draft which its author can correct and resubmit. Earlier reviews remain in the
history. Withdrawal is limited to the author's open requests. Decisions,
comments, policy changes and source transitions are audited. Generic decisions
can be requested from the approvals page; decision comments are optional for
approval and required for rejection or requested changes. Requesters and reviewers can also leave a comment without making a decision.

Only admins record purchase receipt or reimbursement payment after approval.
The source row is locked and its transition and ledger write commit together.
The ledger uses `sourceType` `purchase_request` or `reimbursement`, `sourceId`
and `budgetId`, with the schema's unique source key. Retrying or paying
concurrently produces one expense. Approval alone does not recognise an
expense; recording receipt/payment does. This is the documented finance
cross-area write.

### Approvals API for other areas

`lib/approvals/engine.ts` is server-only. A caller must authenticate, resolve
the workspace server-side, validate input, check its subject's permission and
rate limit before opening an approval. The engine receives trusted server
context, never an unchecked workspace id from a client.

```ts
const pending = await prisma.$transaction(async (tx) => {
  const subject = await createYourSubject(tx); // tenant-scoped, permission checked
  return requestApproval(tx, {
    workspace: { id: actor.workspace.id, slug: actor.workspace.slug },
    subjectType: "CUSTOM", // use the appropriate ApprovalSubjectType
    subjectId: subject.id,
    title: "Approve the workshop proposal",
    requesterId: actor.user.id,
    requesterName: actor.user.name,
    amountMinor: null,
    currency: null,
    // Optional: policyId, or explicit validated steps.
  });
});
await pending.afterCommit();
```

`requestApproval(tx, input)` returns `{ requestId, status, approverIds,
afterCommit }`. It is idempotent for a pending or approved subject. A returned
or rejected subject can be reopened after the owning area authorises its
resubmission. The unique key is `(workspaceId, subjectType, subjectId)`; steps
are frozen when opened. A named policy must belong to the same workspace and
subject type. Explicit steps override the default policy.

`decide(actor, { requestId, decision, comment? })` returns an `ActionResult`
with the resulting status. Decisions are `APPROVED`, `REJECTED` or
`CHANGES_REQUESTED`. It locks the approval row, rechecks eligibility, records
the distinct decision and changes the subject in the same transaction.
`commentOnApproval(actor, { requestId, comment })` adds an audited discussion entry visible to the requester, reviewers and admins. It does not affect quorum. Discussion entries use `decision: PENDING` with a negative step, separate from actual decisions. There is no catalogue event for comments, so they do not send a notification.

`cancelApproval(tx, { workspaceId, subjectType, subjectId, actorId })` records
withdrawal; the caller owns authorisation and the subject transition.

`getApprovalView(actor, subjectType, subjectId)` returns only requests visible
to the requester, a reviewer or an admin. `approvalInbox(actor)` and
`approvalInboxCount(actor)` provide current-step reviews. Archived reviews
from earlier submissions have negative step numbers; show them as earlier
reviews rather than current steps.

Register a subject hook in `lib/approvals/registry.ts`, implementing
`ApprovalHook` from `types.ts`. `onDecided(tx, context)` runs inside the
transaction; scope all writes to `context.workspaceId`. Throw to roll back the
decision. Do not call the engine from a hook, send messages directly or emit
realtime before commit. Hooks must not import the engine (avoids circular
imports). Unregistered subjects still retain approval state and notify; the
owning area reads that state. Existing hooks cover purchases, reimbursements
and vault access. Notifications use `dispatch`, including the finance-specific
events for money subjects.

## Service catalogue and subscriptions

The catalogue records owner, team, service URL, environment, criticality,
lifecycle, runbook, billing date and cost. Admins and the owning team's leads
can edit; only admins change billing fields. Private-team services are hidden
from non-members of that team. Runbooks respect document visibility. Linked
vault metadata requires a vault grant. Monitor and cloud resources are read
by tenant-scoped ids; their rows are never created or updated here. Displayed
status is the worst linked status, or Unknown when there are no checks. This
area never writes `cachedStatus`, which belongs to the monitor worker.

Subscriptions have an owner, billing cycle, currency, next renewal,
auto-renew flag, service link, reminder offsets and scoped notification
destinations. Only admins edit them. Cost visibility follows workspace cost
settings. Monthly/yearly equivalents include active and cancelling monthly,
quarterly and yearly plans, separately per currency; usage and one-time
charges are excluded. This is a planning total, not a currency conversion.
Dates are editable; reminder jobs do not assume a charge actually happened
or automatically advance a renewal date.

## Credentials vault

The vault is **not end-to-end encrypted**. The server can decrypt secrets.
`sealEnvelope(vaultMasterKey(), plaintext)` uses a fresh per-write data key;
`openEnvelope` unwraps it only after access checks. Configure a base64 32-byte
`VAULT_MASTER_KEY` and preserve it securely with backups. No plaintext values
or encryption keys enter search, activity, audit metadata, notifications,
realtime, exports or assistant tools. Missing master keys fail closed.

Supported item types include login, API key, secret note, SSH key, Wi-Fi,
TOTP note and card reference. A card reference accepts exactly four digits;
full card numbers, expiry dates and security codes are not supported. TOTP
notes are encrypted notes, not an authenticator-code generator.

Owners and workspace admins manage items. User, team and role grants can
apply to a collection or item and expire after the requested duration. The
permission ladder is List, Reveal, Edit and Manage. Collection membership is
admin-controlled. A person with List access can request temporary Reveal
access from the item's owner through the approvals engine. Item managers can
revoke item grants; admins manage collection grants. Archiving an item
revokes its item grants and excludes it from all reveals and links.

Sensitive items require a fresh six-digit TOTP step-up. A signed, HttpOnly,
SameSite=Strict proof expires after five minutes, is user-bound, and is
invalidated by session-version or MFA-enrolment changes. TOTP consumption
uses the shared replay protection. The POST reveal endpoint enforces origin,
a non-simple header, authentication, rate limits and no-store response headers.
Reveal, copy and denied access attempts are logged with ids only. The browser
hides revealed text after thirty seconds or when hidden. Clipboard contents
remain under the user's control. Rotations preserve the last five encrypted
versions; previous versions are not exposed by any endpoint.

## Equipment and physical keys

Admins maintain categories, location, condition, availability and maintenance
notes. Members book or borrow available equipment, with due dates and a
return condition. Only the borrower or an admin returns equipment. The
booking transaction locks its asset before checking half-open time intervals
`existing.start < end && existing.end > start`; adjacent bookings are valid.
Checkout also checks other people's bookings and required certifications.
QR labels use `qrcode` and `/a/:tag`; scanning requires sign-in and active
membership before revealing the inventory destination. Key/fob/card registers
store holders and labels. Door codes belong in the vault.

## Forms and intake

Admins build internal or public-link forms with text, long text, email,
number, choice, checkbox and date fields. Keys and choices are validated,
required answers enforced, and unknown answer keys rejected. Questions become
immutable once responses exist so earlier answers remain interpretable;
settings and closure dates can still be edited. The public link is random,
stored as SHA-256 and shown only when issued or rotated. Closing a form
revokes its link. The public page is excluded from indexing and sends a
no-referrer policy.

Public responses have a honeypot, Redis rate limits and a persisted five
responses per form/IP hash/hour cap. Response limits and closure are checked
again under a row lock, so concurrent requests cannot overfill a form. Only
admins view the submissions inbox and CSV exports. CSV cells are quoted and
formula-like values neutralised. Exports stream all responses present when the download starts in bounded batches. Access is rechecked between batches.

Explicit conversion creates one project-free task assigned to the converting admin, with a workspace sequence
and a `RecordLink` from `form_submission` to `task`, then stores the link on
the submission. It locks the submission so retries return the same task.
The task receives a search entry. Only the admin's chosen title is copied: response bodies stay in the inbox.
This Task write is explicitly authorised by the ops-money feature task.

## Scheduled work and demo data

`lib/scheduled/opsMoney.ts` exports `run(now)` for the shared scheduler. It
emits renewal, rotation, booking, overdue checkout, maintenance, budget
threshold and catalogue-gap events. Advisory transaction locks and persisted
event keys prevent duplicate events across replicas. Renewal dates and
rotation anchors are part of the key; overdue equipment is reminded daily.
Vault reminders use generic text and never item values.

`scripts/seed/ops-money.mjs` exports the async demo seed consumed automatically
by `seed-demo.mjs`. It adds requests, policies, a budget, a service,
subscription, equipment booking, maintenance note, key register and form
response. It adds an encrypted demonstration note only when the vault key is
configured. It refuses production and does not seed real credentials.

## Integration notes and limits

No schema or shared-core changes are required. The shared file endpoint
currently restricts ledger receipt files by finance visibility but does not
understand the request's author/reviewer access or additional receipt arrays.
All uploaded receipts therefore use the existing workspace file boundary;
coordinator-owned `lib/files.ts` needs a request-aware policy if tighter
receipt privacy is required. The ops code cannot change that shared contract.

The existing page lists intentionally cap results (100 requests/forms/budgets,
500 equipment/services/subscriptions, 1,000 vault items and inbox responses).
There is no external provider billing sync, vault key-rotation UI, E2E
encryption, automatic card payment, QR label printer integration or CAPTCHA
provider. None of these are simulated.

Run `npm run lint`, `npm run typecheck`, `npm run test:unit`, prepare the
isolated test database, `npm run test:integration` and `npm run build` before
release. Ops tests cover approval state transitions, cryptographic tampering,
cost totals, booking intervals, field validation, grants, MFA expiry, reveal
logs, ledger idempotency, concurrent bookings, public abuse limits and tenant
isolation. Inspect the workspace UI at 375px in both colour modes and by
keyboard. Remove `.next` after the production build, as required by the build
brief.
