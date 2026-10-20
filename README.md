# Space Works Workspace

The private workspace of the Space Works maker community. Members plan builds
on project boards, talk in channels, keep shared docs and files, look after the
community kitty, publish a public blog, give each other shoutouts, and ask the
Space Works Assistant about anything in the workspace.

It is self-hosted, invite-only and built for one community (or a few chapters)
at a time: internal pages require sign-in; public publishing, forms, status pages and bearer feeds have explicit access rules, and each
workspace's data is strictly separated.

Licensed under the [AGPL-3.0-or-later](LICENSE). Copyright 2026 Space Works.

## Features

Invite-only accounts, workspace roles, MFA, instance OIDC sign-in and an audit trail support all areas.

- [Tasks](docs/areas/tasks.md): Projects, kanban boards, recurring tasks, dependencies, cycles and personal tasks.
- [Chat](docs/areas/chat.md): Channels, direct messages, threads, reactions, pins and live updates.
- [Docs files](docs/areas/docs-files.md): Nested rich-text docs, revisions, verification, private files and versions.
- [Community](docs/areas/community.md): Announcements, shoutouts, community events, RSVPs, waitlists and private calendar feeds.
- [Finance blog](docs/areas/finance-blog.md): Community kitty, invoices, finance categories and public blog publishing.
- [Assistant](docs/areas/assistant.md): Assistant conversations, workspace tools, memory, skills, scheduled digests, boardroom, MCP and scoped machine APIs.
- [Integrations messaging](docs/areas/integrations-messaging.md): Google, GitHub, SEO, messaging connections, account linking, channel bridges and signed webhooks.
- [Monitor](docs/areas/monitor.md): Service checks, incidents, maintenance, on-call, public status pages, cloud inventory and costs.
- [People relationships](docs/areas/people-relationships.md): Member profiles, teams, onboarding, certifications, availability, rota, contacts, organisations and pipeline.
- [Ops money](docs/areas/ops-money.md): Service catalogue, subscriptions, encrypted vault, assets, bookings, budgets, purchases, reimbursements, approvals and forms.
- [Work collaboration](docs/areas/work-collaboration.md): Meetings, decisions, goals, key results, polls, ideas, templates, changelog and sign-offs.
- [Platform shell](docs/areas/platform-shell.md): My day, global search, activity, pinned links, command palette, notification centre, preferences, exports, imports, legal hold and retention.
- [App reviews](docs/areas/app-reviews.md): App-store review inbox, replies, triage, insights, task links and notification routing.

## Stack

- Next.js 16 (App Router, standalone output), React 19, TypeScript
- PostgreSQL 16 with Prisma 6
- Auth.js v5 with email and password, optional Google and instance OIDC, TOTP two-step verification
- Tailwind CSS 4 with Radix primitives, following the Space Works design system
- Redis for rate limits and realtime fan-out (Server-Sent Events)
- S3-compatible private storage (Silo locally or on a VPS, Cloudflare R2 in the cloud)
- Email through an outbox with Nodemailer
- Vitest (unit and PostgreSQL integration) and Playwright

## Quick start

Requirements: Node.js 22+, Docker.

```bash
npm ci
docker compose up -d            # PostgreSQL, Redis, Silo and Mailpit
cp .env.example .env            # then set AUTH_SECRET, MFA_ENCRYPTION_KEY and friends
npm run storage:init            # create the private bucket
npm run db:deploy               # apply committed migrations
npm run dev                     # open http://localhost:3000/setup
```

`/setup` appears only while the instance has no accounts. It creates the
owner account and the first workspace with #general, #announcements and
#random. Invite everyone else from **Settings → Invitations**; emails land in
Mailpit at http://127.0.0.1:8025 during development.

Demo data:

```bash
DEMO_PASSWORD="choose-a-long-password" npm run db:seed:demo
```

This creates the "TinkerSpace Kochi" workspace with a few members, channels, a
project board and examples across the feature areas. Modules in `scripts/seed/`
load automatically. Use a development database for demo data.

## Useful scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run lint` / `npm run typecheck` | ESLint and TypeScript |
| `npm run test:unit` | Unit tests |
| `npm run db:test:prepare` then `npm run test:integration` | PostgreSQL integration tests against `TEST_DATABASE_URL` (wiped) |
| `npm run db:migrate` / `db:deploy` / `db:status` | Prisma migrations |
| `npm run db:backup` / `db:restore` | Database backups |
| `npm run production:check` | Production environment preflight |

## Install and deploy

```bash
curl -fsSL https://raw.githubusercontent.com/SpaceWorks-HQ/SpaceWorks-Workspace/main/install.sh | bash
```

The guide asks every deployment question before changing the host: hosting, HTTPS, separate containers or all-in-one, bundled/managed data services, email, owner identity and optional integrations/deploy runner. Production requires HTTPS. Open `/setup` after readiness to create the owner account.

Three matching GHCR images provide the Next.js backend, nginx frontend, and a supervised all-in-one app. Split hosting places nginx on a separate server and proxies all dynamic routes back to Next.js. No host builds are needed. Defaults install into `/opt/spaceworks-workspace`; forks use `--repo Owner/Repo`. Existing installs get backup-first updates and image rollback.

See [the full installer walkthrough](docs/DEPLOYMENT_VPS.md), [Docker](docs/DEPLOYMENT_DOCKER.md), [cloud providers](docs/DEPLOYMENT_CLOUD.md), [AWS](docs/DEPLOYMENT_AWS.md), [Kubernetes](docs/DEPLOYMENT_KUBERNETES.md), [images/tags](docs/CONTAINER_IMAGES.md) and [operations](docs/production-operations.md).

## Operations

- `GET /api/health`: liveness, no dependencies.
- `GET /api/health/db`: readiness, `Authorization: Bearer $HEALTHCHECK_SECRET`.
- `POST /api/internal/outbox`: deliver queued email, `Authorization: Bearer $CRON_SECRET`
  (an in-process worker also runs every minute).
- The instance operator is the account whose email matches `SUPER_ADMIN_EMAIL`;
  `/admin` asks for a fresh two-step code.

## Documentation

- [AGENTS.md](AGENTS.md): conventions for contributors and coding agents
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): request flow, data model and shared services
- [docs/DESIGN.md](docs/DESIGN.md): the Space Works design system in this app
- [CONTRIBUTING.md](CONTRIBUTING.md) and [CHANGELOG.md](CHANGELOG.md)

## Screenshots

Screenshots of My day, project boards, services, the review inbox and mobile navigation will be added here.
