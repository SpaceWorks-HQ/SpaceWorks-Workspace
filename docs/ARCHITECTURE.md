# Architecture

How Space Works Workspace is put together, and the shared services every
feature should build on.

## Request flow

1. `proxy.ts` applies distributed rate limits (Server Actions, `/api/*`,
   Auth.js mutations) and adds a per-request CSP nonce and security headers to
   pages. It never authenticates.
2. Pages and route handlers authenticate: `requireAuth()` /
   `requireWorkspace(slug, minRole)` for pages, `getWorkspaceForAction(slug, minRole)`
   for Server Actions, `auth()` + `findWorkspaceForUser()` for route handlers.
3. Business rules live in `lib/`; Prisma is the only data access path.
4. `instrumentation.ts` validates the production environment at boot and
   starts the in-process outbox worker (disable with `OUTBOX_WORKER=0`).

## Data model

`prisma/schema.prisma` covers every product area from the start:

| Area | Models |
| --- | --- |
| Auth and instance | `User`, `Account`, `Session`, `VerificationToken`, `MfaRecoveryCode`, `PasswordResetToken`, `EmailVerificationToken`, `InstanceSetting`, `OutboxMessage`, `OperationalHeartbeat`, `AuditEvent`, `Notification` |
| Tenancy | `Workspace`, `Membership`, `Invitation`, `ApiToken`, `WorkspaceCounter` |
| Work | `Project`, `BoardColumn`, `Task`, `TaskAssignee`, `Label`, `TaskLabel`, `TaskComment`, `TaskActivity` |
| Chat | `Channel`, `ChannelMember`, `Message`, `MessageReaction`, `MessageAttachment` |
| Knowledge | `Doc`, `DocRevision`, `FileObject` |
| Community | `Announcement`, `CommunityEvent`, `EventAttendee`, `Shoutout` |
| Operations | `FinanceCategory`, `LedgerEntry`, `Invoice`, `BlogPost` |
| Assistant | `AssistantConversation`, `AssistantMessage`, `AssistantMemory`, `AssistantSkill`, `ScheduledJob` |
| Integrations | `IntegrationConnection`, `OAuthState`, `GithubRepo`, `GithubEvent` |
| SEO | `SeoSite`, `SeoMetricDaily`, `SeoAudit` |
| Boardroom | `BoardroomSession`, `BoardroomSeat`, `BoardroomTurn` |
| Foundations (extension) | `Team`, `TeamMember`, `ApprovalPolicy`, `ApprovalRequest`, `ApprovalDecision`, `RecordLink`, `SearchDocument`, `ActivityEvent`, `SavedView`, `Bookmark`, `LinkItem` |
| People | `MemberProfile`, `MemberSkill`, `ChecklistTemplate`, `ChecklistRun`, `ChecklistRunItem`, `Availability`, `ShiftType`, `Shift`, `ShiftAssignment`, `ShiftSwapRequest`, `CertType`, `Certification` |
| Operations (extension) | `ServiceCatalogItem`, `ServiceLink`, `ServiceDependency`, `Subscription`, `VaultCollection`, `VaultItem`, `VaultItemVersion`, `VaultGrant`, `VaultAccessRequest`, `VaultAccessLog`, `Asset`, `AssetCheckout`, `AssetBooking`, `AssetMaintenanceLog`, `AccessCredential` |
| Relationships | `Organisation`, `Contact`, `ContactOrgRole`, `ContactInteraction`, `Deal` |
| Money (extension) | `Budget`, `PurchaseRequest`, `Reimbursement` |
| Work (extension) | `TaskRecurrence`, `TaskOccurrence`, `TaskDependency`, `Cycle`, `Form`, `FormSubmission`, `Goal`, `KeyResult`, `Template` |
| Collaboration | `Meeting`, `MeetingAttendee`, `AgendaItem`, `Decision`, `MeetingActionItem`, `Poll`, `PollOption`, `PollVote`, `PollBallotReceipt`, `CalendarFeedToken`, `SignatureRequest`, `Idea`, `IdeaVote`, `ChangelogEntry` |
| Platform | `FileVersion`, `ExportJob`, `ImportJob`, `BackupRun`, `RetentionPolicy`, `SsoProvider` |
| Services monitor | `Monitor`, `MonitorCheck`, `MonitorRollup`, `HeartbeatPing`, `Incident`, `IncidentMonitor`, `IncidentUpdate`, `MaintenanceWindow`, `MaintenanceWindowMonitor`, `OnCallSchedule`, `EscalationPolicy`, `MonitorNetworkAllowlist`, `CloudConnection`, `CloudResource`, `CloudMetricSample`, `CostSnapshot`, `CostBudget`, `StatusPage`, `StatusPageComponent` |
| Messaging and routing | `MessagingConnection`, `NotificationDestination`, `NotificationRule`, `NotificationRuleDestination`, `NotificationPreference`, `NotificationUserSettings`, `NotificationMute`, `NotificationEventRecord`, `NotificationDelivery`, `NotificationDigestItem`, `ExternalIdentityLink`, `LinkCode`, `BridgedChannel`, `BridgedMessage`, `InboundEvent`, `MessagingConversation` |

Who builds and owns each model, route and helper is in
[ROADMAP-BUILD.md](ROADMAP-BUILD.md).

Notes:

- Deleting a workspace cascades to all of its rows. Deleting a user removes
  their memberships and personal rows and sets authored content to `null`.
- Per-workspace numbers (task `number`, invoice `number`) come from
  `nextWorkspaceSequence(tx, workspaceId, "task" | "invoice")`.
- Money is an integer in minor units (`amountMinor`, `totalMinor`) plus an
  ISO currency code.
- Platform extension conventions: tenant roots cascade with their
  workspace and personal rows with their user; `createdById`, `ownerId`,
  `teamId` and similar actor/owner columns are plain ids (resolve names by
  lookup, show "Former member" when gone). Encrypted columns (`*Enc`) are
  `lib/crypto.ts` strings with a dedicated purpose; the vault uses envelope
  encryption under `VAULT_MASTER_KEY`. `Channel.teamId` / `Project.teamId`
  scope records to a team (private teams hide them, see `lib/teamAccess.ts`).
  `Message.origin` marks routing cards (`"notify"`) and bridged messages
  (`"bridge:<id>"`). `TelegramLink` was replaced by the generic
  `ExternalIdentityLink` + `LinkCode`.
- Global search across areas: `SearchDocument` has a generated
  `searchVector` (title A, body B) and a trigram index on `title`
  (`pg_trgm`), queried with `$queryRaw` like the per-table vectors below.
- Full-text search: `Task`, `Message` and `Doc` have a generated
  `searchVector tsvector` column (config `simple`) with a GIN index. Prisma
  maps it as `Unsupported`, so query it with raw SQL, always filtered by
  workspace:

  ```ts
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Message"
    WHERE "workspaceId" = ${workspaceId} AND "deletedAt" IS NULL
      AND "searchVector" @@ websearch_to_tsquery('simple', ${query})
    ORDER BY ts_rank("searchVector", websearch_to_tsquery('simple', ${query})) DESC
    LIMIT 50`;
  ```

## Shared services

### Permissions — `lib/permissions.ts`, `lib/roles.ts`

```ts
requireAuth(): Promise<SessionUser>                               // redirects to /login
requireWorkspace(slug, minRole = "GUEST"): Promise<{ user, workspace, membership }>  // notFound() otherwise
getWorkspaceForAction(slug, minRole = "GUEST"): Promise<WorkspaceContext | null>     // for Server Actions
findWorkspaceForUser(slug, userId): Promise<{ workspace, membership } | null>         // for route handlers
requireSuperAdmin() / requireSuperAdminMfa()
// lib/roles.ts (pure, client-safe)
hasRoleAtLeast(role, min); canContribute(m); canManageMembers(m); canManageLabels(m);
canManageChannels(m); canManageFinance(m); canViewFinance(m, workspace); canManageBlog(m);
canManageApiTokens(m); canManageIntegrations(m); canViewAuditLog(m); canManageWorkspace(m);
canDeleteWorkspace(m); canTransferOwnership(m); assignableRoles(actor); canActOnMember(actor, targetRole)
```

### Realtime — `lib/realtime.ts`, `components/realtime/useRealtime.ts`

```ts
publish(workspaceId: string, channel: string, event: { type: string; data?: Record<string, string|number|boolean|null>; audience?: string[]; actorId?: string|null }): Promise<void>
publishToUser(workspaceId: string, userId: string, event: { type; data?; actorId? }): Promise<void>
subscribe(workspaceId: string, handler: (event: RealtimeEvent) => void): Promise<() => void>
// browser
useRealtime(workspaceSlug: string, onEvent: (event: RealtimeEvent) => void): void
```

- Transport: Redis pub/sub on `sww:rt:<workspaceId>`; in-process EventEmitter
  when `REDIS_URL` is unset. Publishing never throws.
- SSE endpoint: `GET /api/realtime/[workspaceSlug]` (members only, 404
  otherwise, 25 s heartbeat, reconnect every 10 minutes so revoked access
  ends promptly).
- Channel names: `"workspace"`, `"channel:<id>"`, `"project:<id>"`,
  `"task:<id>"`, `"doc:<id>"`, `"user:<id>"`. `user:` channels and `audience`
  lists are filtered per connection (`isEventVisibleTo`).
- Events carry ids and kinds, never content. Clients refetch.

### Storage — `lib/storage/index.ts`, `lib/storage/policy.ts`

```ts
uploadWorkspaceFile({ workspaceId, uploadedById, file: File, folder?, docId?, taskId?, allowedTypes?, maxBytes?, client? })
  : Promise<{ ok: true; file: FileObject } | { ok: false; error: string }>
fileUrl(fileId, { download? }): string          // "/api/files/<id>"
fileResponse(file, { download? }): Promise<Response>
putObject(key, body, contentType) / getObject(key) / deleteObjects(keys)
checkUpload({ size, type }, maxBytes?) / sanitizeFilename(name) / buildStorageKey(workspaceId, filename)
```

Keys are `workspaces/<workspaceId>/files/<uuid>/<name>`. Images are decoded
with sharp before storage. Downloads go through `GET /api/files/[id]`
(`lib/files.ts#findDownloadableFile`: active membership, admin-only docs,
finance receipts). Inline display only for raster images and PDFs, always
with `nosniff` and a sandboxing CSP. Without `S3_BUCKET` in development,
objects are written to `.data/storage`.

### Notifications — `lib/notifications.ts`

```ts
createNotifications(inputs: NotificationInput[], { client?, excludeUserId? }): Promise<number>
createNotification(input, options)
announceNotifications(rows)        // call after committing when you passed a transaction client
listNotifications(userId, { workspaceId?, unreadOnly?, take? })
countUnreadNotifications(userId, workspaceId?)
markNotificationsRead(userId, ids?)
// NotificationInput = { userId, workspaceId?, kind, title, body?, url? (app-relative) }
```

### Notification routing — `lib/notify`

```ts
dispatch(workspaceId, event: NotificationEvent<T>, { tx?, onlyDestinationIds?, test?, now? }): Promise<DispatchResult>
sendTest(workspaceId, destinationId, actorId)
setScopedDestinations(client, { workspaceId, scopeType, scopeId, destinationIds, actorId, eventTypes? })   // "Send to" picker data
getScopedDestinationIds(workspaceId, scopeType, scopeId) / listPickableDestinations(workspaceId, role)
EVENT_CATALOG / EventPayloads / NOTIFY_CATEGORIES (lib/notify/events.ts, client-safe)
```

- Every notification goes through `dispatch`. The event `type` must be in
  the catalogue and `data` matches its payload type. Broadcast events are
  routed by enabled rules (`eventTypes` exact / `area.*` / `*`, minimum
  severity, filters, scope): workspace rules unless `useWorkspaceRules:
  false`, plus the entity's scoped rule when `scope` carries its id
  (`SCOPE_KEYS`). Personal events go to `recipients` minus the actor who are
  active members at the catalogue's minimum role and have not muted the
  resource: always in-app, plus their preferred channels (member row →
  workspace default → catalogue default; DM channels need a verified
  `ExternalIdentityLink`; guests get in-app and email only).
- Quiet hours (rule or member), snooze and digests delay or hold
  non-critical deliveries; critical events bypass when allowed.
  `dedupeKey` drops repeats per target inside the rule window (personal:
  `dedupeWindowSec`, default 300 s); `reminderOf` bypasses dedupe;
  `threadKey` lets adapters reply in thread.
- In-app notifications (`Notification`, with `eventId`) and `IN_APP_USERS`
  destinations are written inline. Every other delivery is a
  `NotificationDelivery` plus an outbox row of kind `notify.deliver`; the
  outbox worker calls `processNotifyDelivery`, which renders a
  `RenderedMessage` and calls the adapter registered in
  `lib/notify/adapters/index.ts` (built in: email via `enqueueEmail`,
  workspace channel SYSTEM message; Slack, Discord, Mattermost, Telegram,
  WhatsApp and webhook are "not configured" placeholders replaced file by
  file). Retries back off 30 s → 6 h for six attempts; a shared destination
  that fails for good turns `ERROR` and admins get one
  `destination.failing` alert a day.
- With `{ tx }` the event commits with the caller's change; call
  `result.afterCommit()` after the transaction for realtime nudges.

### Shared extension hooks

```ts
indexSearchDocument(input, client?) / removeSearchDocument(entityType, entityId, client?)   // lib/search/documents.ts
recordActivity(input, client?)                                                                // lib/activity.ts
userTeamIds(workspaceId, userId) / hiddenTeamIds(workspaceId, member) / teamScopeFilter(hidden) // lib/teamAccess.ts
run(now)  // lib/scheduled/<area>.ts — called about once a minute by the outbox tick (idempotent)
sealEnvelope(masterKey, plaintext) / openEnvelope(masterKey, sealed) / vaultMasterKey()       // lib/crypto.ts
```

### Audit — `lib/audit.ts`

```ts
recordAuditEvent({ action, workspaceId?, actorId?, actorApiTokenId?, targetType?, targetId?, metadata?, client?, ip? })
listAuditEvents(workspaceId, { take?, cursor? })
```

Actions are dotted verbs (`member.role_changed`, `task.deleted`). Metadata is
small scalars only; never secrets, tokens or message bodies.

### Email — `lib/outbox.ts`, `lib/email/templates.ts`

```ts
enqueueEmail(client, { to, subject, html, text })        // any pre-rendered email (no bearer links)
enqueueInviteEmail(client, { to, workspaceName, inviterName, role, inviteUrl, expiresAt })
enqueuePasswordReset(client, { to, resetUrl, expiresAt })
enqueueEmailVerification(client, { to, verificationUrl, expiresAt })
renderNotificationEmail({ title, bodyHtml, actionUrl?, actionLabel? })   // brand layout for digests
```

Delivery: in-process worker every minute plus `POST /api/internal/outbox`
(`Authorization: Bearer $CRON_SECRET`). Capability emails are deleted after
delivery or terminal failure.

### Other helpers

- `lib/counters.ts`: `nextWorkspaceSequence(client, workspaceId, name)`.
- `lib/workspaces.ts`: `createWorkspaceWithDefaults`, `createDefaultBoardColumns(tx, projectId)`,
  `joinDefaultChannels(tx, workspaceId, userId)`, `listUserWorkspaces(userId)`.
- `lib/nav.ts`: the single sidebar config (`NAV_GROUPS`, `navForMember`).
- `lib/instanceSettings.ts`: `getAssistantSettings()` → `{ apiKey, model }`,
  `getEmailSettings()`, `getGoogleSsoSettings()`, `setInstanceSettings()`.
- `lib/integrationSecrets.ts`: `encryptIntegrationToken`, `decryptIntegrationToken`.
- `lib/crypto.ts`: `randomToken`, `sha256Hex`, `safeEqual`, `encryptSecret`, `decryptSecret`.
- `lib/rateLimit.ts` / `lib/actionRateLimit.ts`: buckets include `message`,
  `assistant`, `upload`, `search`, `apiRead`, `apiWrite`, `webhook`.
- `lib/format/datetime.ts`, `lib/format/money.ts`, `lib/slug.ts`, `lib/labels.ts`.
- `lib/actionResult.ts`, `lib/validation.ts`: action return shape and shared Zod schemas.

## Routes

| Route | Access |
| --- | --- |
| `/setup` | Only while the instance has no users |
| `/login`, `/forgot-password`, `/reset-password/[token]`, `/invite/[token]` | Public |
| `/` | Redirects: setup → login → last workspace → "no workspace yet" |
| `/w/[workspaceSlug]/…` | Members (per-page minimum role) |
| `/account` | Signed in |
| `/admin/…` | Super-admin + fresh TOTP (`/admin-mfa`) |
| `/api/health` | Public liveness |
| `/api/health/db` | `Bearer $HEALTHCHECK_SECRET` |
| `/api/internal/outbox` | `Bearer $CRON_SECRET` (POST) |
| `/api/files/[id]` | Members of the file's workspace |
| `/api/realtime/[workspaceSlug]` | Members (SSE) |
| `/api/account/export` | Signed in, own data only |

### Placeholder routes (to be replaced)

The platform extension added more placeholders (teams, polls, ideas,
cycles, meetings, goals, forms, services, catalogue, vault, contacts,
assets, requests, subscriptions, rota, settings/notifications,
settings/messaging, settings/cloud-accounts, settings/onboarding,
notifications/preferences, notifications/accounts); see
[ROADMAP-BUILD.md](ROADMAP-BUILD.md) for their roles and owners.

These pages exist so navigation works; each renders the shared
`ComingSoon` component and already calls `requireWorkspace` with its minimum
role. Replace the file in place:

| Route | Min role |
| --- | --- |
| `app/w/[workspaceSlug]/announcements/page.tsx` | GUEST |
| `app/w/[workspaceSlug]/members/page.tsx` | GUEST |
| `app/w/[workspaceSlug]/shoutouts/page.tsx` | GUEST |
| `app/w/[workspaceSlug]/calendar/page.tsx` | GUEST |
| `app/w/[workspaceSlug]/projects/page.tsx` | GUEST |
| `app/w/[workspaceSlug]/my-tasks/page.tsx` | MEMBER |
| `app/w/[workspaceSlug]/docs/page.tsx` | GUEST |
| `app/w/[workspaceSlug]/files/page.tsx` | GUEST |
| `app/w/[workspaceSlug]/chat/page.tsx` | GUEST |
| `app/w/[workspaceSlug]/dm/page.tsx` | MEMBER |
| `app/w/[workspaceSlug]/finance/page.tsx` | MEMBER + `canViewFinance` |
| `app/w/[workspaceSlug]/blog/page.tsx` | ADMIN |
| `app/w/[workspaceSlug]/seo/page.tsx` | ADMIN |
| `app/w/[workspaceSlug]/assistant/page.tsx` | MEMBER |
| `app/w/[workspaceSlug]/boardroom/page.tsx` | MEMBER |
| `app/w/[workspaceSlug]/settings/api-tokens/page.tsx` | ADMIN |
| `app/w/[workspaceSlug]/settings/integrations/page.tsx` | ADMIN |

Not created yet (later phases add them): the public blog
`/blog/[workspaceSlug]/[postSlug]`, `/api/mcp`, `/api/v1/*`, the public
status page `/status/[workspaceSlug]`, heartbeats `/api/hb/[token]`, public
forms `/f/[publicSlug]`, calendar feeds `/ics/[token]`, and the integration
webhooks under `/api/integrations/**`.
