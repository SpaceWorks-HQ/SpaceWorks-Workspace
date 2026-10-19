# Chat

Channels, direct messages, threads, reactions, pins, attachments and search,
with realtime updates. Owned by the chat build (see
[ROADMAP-BUILD.md](../ROADMAP-BUILD.md), row 2).

## Routes

| Route | Min role | What it is |
| --- | --- | --- |
| `/w/[slug]/chat` | GUEST | Conversation list (phones) / list + channel browser (wider) |
| `/w/[slug]/chat/browse` | GUEST | Channel browser: search, join, create, archived (admins) |
| `/w/[slug]/chat/search?q=` | GUEST | Message search across everything the member can read |
| `/w/[slug]/chat/[channelSlug]` | GUEST | A channel. `?m=<id>` opens around a message, `?thread=<id>` opens a thread |
| `/w/[slug]/dm` | MEMBER | DM home: recent conversations and the crew. `?to=<userId>[,<userId>]` opens "New message" prefilled (link here from member profiles) |
| `/w/[slug]/dm/[channelId]` | MEMBER | A direct message (same `?m=` / `?thread=`) |

`browse`, `new`, `search`, `settings`, `dm` and `api` are reserved channel names.
Both `chat/` and `dm/` have a layout that renders the shared frame
(`components/chat/ChatShell.tsx`); every page still calls `requireWorkspace`.

## Code map

| Path | Purpose |
| --- | --- |
| `app/actions/chat.ts` | Server Actions (reads and writes). Auth → workspace → rate limit → zod → `lib/chat/service.ts` |
| `lib/chat/access.ts` | `resolveChannel` (the only way to load a channel), `readableChannelIds`, `channelAudience`, `channelInfo` |
| `lib/chat/service.ts` | Mutations: channels, membership, DMs, post/edit/delete, reactions, pins, read markers, typing, uploads |
| `lib/chat/queries.ts` | Sidebar with unread counts, timeline/thread/pinned pages, members, browse, search, layout data |
| `lib/chat/render.ts` | Message rows → viewer-specific `MessageDTO` (rendered HTML, permissions, reactions, attachments) |
| `lib/chat/markdown.ts`, `lib/chat/sanitize.ts` | Markdown-lite renderer and the server-side `sanitize-html` allow-list |
| `lib/chat/text.ts` | Token helpers: mentions, channel links, broadcasts, task refs, plain text, autocomplete trigger |
| `lib/chat/policy.ts`, `dm.ts`, `unread.ts`, `cursor.ts`, `reactions.ts` | Pure rules (unit-tested) |
| `lib/chat/client.ts` | Client-safe barrel of the pure modules |
| `components/chat/*` | Frame, sidebar, conversation, composer, message row, thread and side panels, dialogs |

## Message format

Bodies are stored as typed (normalised) with tokens instead of names:
`<@userId>` (mention), `<#channelId>` (channel link), `<!channel>` / `<!here>`
(broadcast). The composer turns picked `@Name` into tokens; the server
re-checks them (`sanitizeTokens`): unknown members become `@unknown`,
broadcasts need MEMBER+ outside DMs, `#slug` becomes `<#id>` for channels
the author can read. Rendering escapes everything, applies the markdown
subset (bold, italic, strike, code, fenced code, links, bare URLs, lists,
quotes), resolves tokens for the viewer (hidden channels render as
`#private-channel`) and links task references like `BOT-12` when the task
exists and is visible. The HTML then passes `sanitize-html` on the server.
Other areas that read message bodies (bridges, the assistant) can use
`toPlainText(body, names, channels)` from `lib/chat/text.ts`.

`Message.origin` is rendered distinctly: `"notify"` as a routing card,
`"bridge:<id>"` with a "via Slack/Discord/…" pill, `authorKind` ASSISTANT with
the assistant badge.

## Access rules

- PUBLIC: readable by MEMBER+ (preview before joining); guests only when added.
  Channels of a private team are hidden from non-team members unless added.
- PRIVATE and DIRECT: channel members only. Admins do not see private
  channels or DMs they are not in. DMs need MEMBER+.
- Posting needs channel membership and an unarchived channel.
- Create: PRIVATE for MEMBER+, PUBLIC for ADMIN+. Rename, default, archive:
  ADMIN+. Topic: channel members (MEMBER+). Add people: channel members
  (MEMBER+) or admins. Remove: admins, or the creator of a private channel.
- Messages: authors edit their own (not bridged/system); authors or admins
  delete (admins never in DMs; moderation deletes are audited). Pins: admins
  or the author in channels, anyone in a DM.
- Rate limits: `message` for post/edit/delete, `upload`, `search`, `action`.

## Unread and notifications

- `ChannelMember.lastReadAt` is the read marker (never moves backwards);
  unread = top-level messages from others after it (or after `joinedAt`).
  The sidebar counts unread and mentions per channel in one SQL query.
  Thread replies notify instead of counting as channel unread.
- `dispatch()` events (inside the post transaction, `scope.channelId` so
  channel mutes apply): `mention` (resource `message`, or `thread` for
  replies), `message.dm` (dedupe `dm:<channelId>` 90 s), `thread.reply`
  (resource `thread`, dedupe `thread:<parentId>` 90 s). One notification per
  person per message: mention > DM > thread reply.
- Channel level (`ChannelMember.notify`): ALL = mentions, @channel and thread
  replies; MENTIONS = direct mentions and DMs; NONE = muted (nothing; the
  sidebar shows a muted row).

## Realtime

All events carry ids only and set `audience` for private channels, DMs and
team channels: `message.created|updated|deleted` (`channelId`, `messageId`,
`parentId`), `channel.updated`, `channel.members`, `typing` on
`channel:<id>`; `chat.read` and `chat.membership` on `user:<id>`. The chat
frame opens its own EventSource (alongside the shell's) so it can see the
`ready` event of every reconnect and catch up: the timeline reloads the
latest page and merges, threads and the sidebar refetch. Coming back to a
hidden tab does the same.

## Search and activity

Public-channel messages and public channels are indexed with
`indexSearchDocument` (`entityType` `message` / `channel`, `channelId`,
`teamId`). Private channels and DMs are never indexed globally; chat's own
search (`searchMessages`) queries the `Message.searchVector` limited to
readable channels. Channel creation and archiving are recorded with
`recordActivity`.

## Known gaps (for the coordinator)

- `lib/files.ts#findDownloadableFile` (shared) does not check channel
  membership for message attachments, so a member who learns a file id from a
  private channel or DM could download it. Suggest: deny when the file has
  `messageAttachments` in channels the user can't read.
- Chat uploads use folder `/chat`; the Files area should hide files that are
  message attachments (or that folder) from its browser.
- Deleting a message keeps its attachments' `FileObject` rows (chat does not
  own `FileObject`); retention could purge them.
- No workspace setting for "members may create public channels"; the policy
  is fixed in `lib/chat/policy.ts` (private: members, public: admins).
- Mutes from the notification centre (`NotificationMute`, resource
  `channel`/`thread`) are honoured by dispatch; chat itself sets only
  `ChannelMember.notify`.
- Demo data: `scripts/seed/chat.mjs` (not registered; see its header).
