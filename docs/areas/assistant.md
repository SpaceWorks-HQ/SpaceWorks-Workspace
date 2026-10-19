# Area: assistant

The Space Works Assistant, its scheduled jobs, workspace memory and skills,
the Boardroom, API tokens, the MCP server and the machine API.

## Routes

| Route | Access | What |
| --- | --- | --- |
| `/w/[slug]/assistant`, `/assistant/c/[conversationId]` | MEMBER | Web chat: conversation list, streaming answers, tool cards, confirm card for changes, stop, rename, delete, token count. "Not configured" state with a link for the super-admin. |
| `POST /w/[slug]/assistant/chat` | MEMBER, same-origin JSON | SSE stream of one turn (`text`, `tool`, `confirm`, `title`, `done`, `error`). Rate bucket `assistant`. |
| `/w/[slug]/assistant/memory` | ADMIN | Search, add, edit, delete `AssistantMemory`. |
| `/w/[slug]/assistant/skills` | ADMIN | Markdown skills; enabled ones go into the system prompt. "Add them" installs the three built-ins (weekly review, meeting prep, onboarding buddy). |
| `/w/[slug]/assistant/jobs` | ADMIN | `ScheduledJob` CRUD with cron + time zone preview, "Post the result in" channel, "Send to" destinations, run now. Morning digest and weekly review templates. |
| `/w/[slug]/boardroom`, `/boardroom/[sessionId]` | MEMBER | New session (2–5 seats from persona presets or custom, 1–3 rounds), history, live transcript (realtime `boardroom:<id>`), outcome, delete (creator or admin). |
| `GET /w/[slug]/boardroom/[sessionId]/export` | MEMBER | Markdown download (docs are not written cross-area). |
| `/w/[slug]/settings/api-tokens` | ADMIN | Create (scopes, expiry, secret shown once), prefix, last used, revoke. |
| `POST /api/mcp` | API token with `mcp` | MCP Streamable HTTP (stateless JSON). See [../MCP.md](../MCP.md). |
| `/api/v1/**` | API token scopes | Tasks, projects, channel messages, docs, members. See [../API.md](../API.md). |

## Code

- `lib/assistant/tools/*`: the single `sw_*` registry (zod inputs, JSON
  Schema via `z.toJSONSchema`). `executeTool(principal, name, input, { via })`
  validates, checks `toolAccess` (role, token scope, `mcp`, jobs read-only,
  per-tool gates), rate-limits writes (`apiWrite`), runs and audits.
  Visibility helpers in `tools/access.ts` (private teams, channels, admin-only
  docs; DMs never).
- `lib/assistant/principal.ts`: `user` (signed-in member), `token` (acts for
  its creator, who must still be an active ADMIN+; no private channels), `job`
  (creator capped at MEMBER, no private channels, read-only).
- `lib/assistant/agent.ts`: streamed tool-use cycle (`eager_input_streaming`,
  cached system block + tool list, top-level auto caching, effort, refusal
  fallback `fallbacks: "default"` on Opus/Sonnet 5.5). Chat pauses on any
  write and asks for confirmation; declined or abandoned writes get an error
  tool result. History is append-only and thinking blocks are stored and
  replayed unchanged.
- `lib/assistant/chat.ts`, `client.ts`, `prompt.ts`, `markdown.ts` (React-only
  renderer, no HTML injection), `cron.ts`, `jobs.ts`, `boardroom.ts`,
  `boardroomPrompts.ts`, `memory.ts` (FTS on the fly), `skills.ts`.
- `lib/apiTokens/*`: token generation (`sww_<prefix>_<secret>`, SHA-256 of
  the secret), authentication, v1 route helpers. `lib/mcp/server.ts`.
- `lib/scheduled/assistant.ts`: `runDueJobs` (claims by conditional update on
  `nextRunAt`, max 3 per tick) and `failStaleBoardrooms` (RUNNING for 20 min
  without a turn → FAILED).

## Models and settings

- Default model from instance settings (`ai.model` / `ASSISTANT_MODEL`,
  default `claude-opus-5-5`); jobs use `ASSISTANT_JOB_MODEL` (default
  `claude-haiku-5-5`, effort low). The Boardroom uses the seat's `model` or the
  default (effort low for seats, medium for the moderator).
- `SEARXNG_URL` enables `sw_web_search` (in-app only).

## Notifications and audit

- `digest.ready` for every successful job run (broadcast, `scope.digestId =
  job.id`; the job's "Send to" is a scoped `DIGEST` rule with
  `eventTypes: ["digest.ready"]`), `assistant.job.completed` to the creator
  (ok or failed), `boardroom.summary_ready` to the session creator.
- Audit actions: `assistant.task_created`, `assistant.task_updated`,
  `assistant.message_sent`, `assistant.doc_created`, `assistant.memory_*`,
  `assistant.skill_*`, `assistant.skills_installed`, `assistant.job_*`,
  `boardroom.session_*`, `api_token.created`, `api_token.revoked`. Metadata
  carries `via` (`chat`, `mcp`, `api`, `job`); token writes set
  `actorApiTokenId`.

## Cross-area writes (for the coordinator)

The assistant's write tools create rows owned by other areas, mirroring what
the owning area's UI does: `Task` (+ `TaskAssignee`, `TaskActivity`,
`SearchDocument`, `ActivityEvent`, `task.assigned` / `task.status_changed`),
`Message` (USER messages from `sw_send_channel_message`, ASSISTANT messages
from jobs) and `Doc` (`sw_create_doc`, WORKSPACE visibility, TipTap JSON +
sanitised HTML + text). They are listed here because the ownership map only
says "write tools need confirmation"; please add them to the cross-area table.

## Gaps and follow-ups

- `.env.example` / `lib/env.ts` should list `ASSISTANT_JOB_MODEL` (optional).
- The "Send to" picker is a minimal local one; swap in
  `components/notify/DestinationPicker` once integrations-messaging lands.
- Jobs run inside the scheduled tick (up to three per minute); very slow
  model calls delay the rest of that tick.
- The messaging bot (Telegram etc.) can call `runChatTurn` with a `user`
  principal for the linked member.
- Seed: `node --env-file-if-exists=.env scripts/seed/assistant.mjs` after the
  main demo seed (not registered: `scripts/seed-demo.mjs` has no registry).
