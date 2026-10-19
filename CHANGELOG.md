# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Foundation: Next.js 16 / Prisma 6 / Auth.js v5 project scaffold, tooling and tests.
- Complete data model for every product area in one initial migration, with
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
- Shared services for later features: realtime SSE fan-out over Redis, private
  file storage with an authorised download route, notifications, audit log,
  email outbox, rate limits and per-workspace counters.
- Health, readiness and outbox scheduler endpoints; demo seed for
  "TinkerSpace Kochi".
