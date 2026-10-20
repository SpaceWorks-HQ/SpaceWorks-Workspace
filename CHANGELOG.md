# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Removed

- Equipment lending and reservations, community events and responses, shoutouts,
  and blog publishing, because Workspace is the internal operations tool;
  member-facing events, bookings and publishing live in the other Space Works products.
  Internal assets, physical access records, meetings, rota and personal feeds remain.

### Added

- Projects, kanban boards, recurring tasks, dependencies, cycles and personal tasks.
- Channels, direct messages, threads, reactions, pins and live updates.
- Nested rich-text docs, revisions, verification, private files and versions.
- Announcements and private personal feeds for internal work.
- Community kitty, invoices and finance categories.
- Assistant conversations, workspace tools, memory, skills, scheduled digests, boardroom, MCP and scoped machine APIs.
- Google, GitHub, SEO, messaging connections, account linking, channel bridges and signed webhooks.
- Service checks, incidents, maintenance, on-call, public status pages, cloud inventory and costs.
- Member profiles, teams, onboarding, certifications, availability, rota, contacts, organisations and pipeline.
- Service catalogue, subscriptions, encrypted vault, internal assets, physical access records, budgets, purchases, reimbursements, approvals and forms.
- Meetings, decisions, goals, key results, polls, ideas, templates, changelog and sign-offs.
- My day, global search, activity, pinned links, command palette, notification centre, preferences, exports, imports, legal hold and retention.
- App-store review inbox, replies, triage, insights, task links and notification routing.
- Instance OIDC providers for existing active members with verified emails, stable subject linking and local MFA completion. The v2 session cookie requires a fresh sign-in after upgrading.
- Project cycles settings, GitHub pull requests and issues on project overviews, and role-aware services and app-review summaries on My day.
- Shared retention writers for chat content, activity, notifications and deliveries, monitor raw results, assistant conversations, audit, inbound events and completed outbox jobs; legal hold protects workspace records.

### Fixed

- Notification-rule rating filters survive editor saves and combine with minimum severity during delivery planning.
- Global search checks app reviews and incidents against live tenant and role access; decisions also require access to their parent meeting.
- Outbox retry tests claim their own jobs; integration cleanup removes tenant jobs before deleting their ownership records.
- All completed areas and settings are reachable through role-aware navigation, with pinned links in the sidebar.
- Removed unused variables and retired the unused feature placeholder.

### Foundation

- Foundation: Next.js 16 / Prisma 6 / Auth.js v5 project scaffold, tooling and tests.
- Complete data model for every product area with committed migrations, with
  generated full-text search columns on tasks, messages and docs.
- Space Works brand: tokens, Gilroy and Unbounded fonts, logos, light and dark
  colour modes, and the shared UI primitives in `components/ui`.
- First-run setup that creates the instance owner, the first workspace and the
  default channels (#general, #announcements, #random).
- Invite-only sign-in with email and password, optional Google sign-in for
  invited members, TOTP two-step verification with recovery codes, password
  reset by email and invitation acceptance.
- Workspace shell with grouped text-only navigation by role, workspace
  switcher, notifications and a home dashboard.
- Workspace settings: general details, members (roles, suspension, removal with
  last-owner protection), invitations, labels and the audit log.
- Account area: profile and skills, password, two-step verification, colour
  mode, sign out everywhere and a JSON data export.
- Instance admin with TOTP step-up: encrypted instance settings (SMTP, Google,
  assistant key), workspaces, users and email outbox health.
- Shared services across features: realtime SSE fan-out over Redis, private
  file storage with an authorised download route, notifications, audit log,
  email outbox, rate limits and per-workspace counters.
- Health, readiness and outbox scheduler endpoints; demo seed for
  "TinkerSpace Kochi".
