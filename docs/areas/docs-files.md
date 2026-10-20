# Docs and files

Shared pages (a nested tree with a rich-text editor) and the files library
(folders, versions, previews). Owner: the docs-files build.

## Routes

| Route | Access | What |
| --- | --- | --- |
| `/w/[slug]/docs` | GUEST | Docs home: search (`?q=`), "Your pages to review", recently edited |
| `/w/[slug]/docs/[docId]` | GUEST (edit: MEMBER) | Page with editor, autosave, presence, actions menu |
| `/w/[slug]/docs/[docId]/history` | GUEST (restore: MEMBER) | Saved versions with preview (`?rev=`) and restore |
| `/w/[slug]/docs/archived` | GUEST (restore: creator or ADMIN) | Pages archived on their own |
| `/w/[slug]/docs/[docId]/export?format=md\|html` | GUEST | Markdown or standalone HTML download |
| `POST /w/[slug]/docs/[docId]/presence` | GUEST | Presence ping (`viewing` / `editing` / `left`) |
| `/w/[slug]/files` | GUEST (upload: MEMBER) | Library: folders (`?folder=`), search by name (`?q=`), usage tiles |
| `/w/[slug]/files/[fileId]` | GUEST | Preview (image, PDF, text), details, links, versions |
| `/w/[slug]/files/deleted` | GUEST (restore: uploader or ADMIN) | Recently deleted (30 days) |
| `POST /w/[slug]/files/upload` | MEMBER | One file per request (progress): library, `docId` (editor images) or `replaceFileId` (new version) |
| `GET /w/[slug]/files/[fileId]/versions/[n]` | GUEST | Download any version (same check as `/api/files/[id]`) |

The `docs` layout renders the page tree (`components/docs/DocsShell.tsx`)
and owns the docs view's single realtime connection; every page still calls
`requireWorkspace` itself.

## Rules

- **Roles.** GUEST reads WORKSPACE pages and library files. MEMBER creates,
  edits, moves, duplicates, verifies pages and uploads, renames, moves, links
  and versions files. Archiving a page: its creator or an admin. Deleting a
  file: its uploader or an admin. ADMIN reads, edits and manages ADMINS-only
  pages (`lib/docs/rules.ts`).
- **Admin-only branches.** A page under an ADMINS page is ADMINS too: making
  a page admin-only applies to its whole branch, creating or moving a page
  under one makes it admin-only, and a page inside one cannot be shared on
  its own. Members' trees therefore never have holes. Files attached to an
  ADMINS page are hidden by the shared download check (`lib/files.ts`).
- **HTML is canonical.** The editor sends HTML; `lib/docs/sanitize.ts`
  sanitises it on every write (allow-list matching the editor: headings,
  lists, task lists, code blocks, tables, links, mentions, and images only
  from `/api/files/<id>`) and again before any render outside the editor.
  `Doc.content` (editor JSON) is cleared on save so it never goes stale.
- **Conflict-safe autosave.** Saves are debounced (1.2 s) and carry the
  `updatedAt` the editor loaded. A save against an older version is refused
  (`conflict`), nothing is overwritten, and the page offers "Copy my version"
  and "Reload". Structure-only changes (move, visibility, verify) keep
  `updatedAt`, so they never cause a false conflict.
- **Revisions.** One `DocRevision` per editing session: the same author
  within 10 minutes refreshes their latest snapshot, a different author or a
  pause starts a new one. Restoring a revision adds a new revision.
- **Verification.** "Verify…" sets `verifiedUntil` (30/90/180/365 days) and
  makes the verifier the review owner (`verifiedById`). Badges: Verified,
  Review by (7 days before), Needs review. The docs home lists the viewer's
  own pages that are due.
- **Files library.** Shows workspace files that belong to no other area:
  message attachments and the reserved `/chat` folder, receipts, contracts, certification evidence, status-page logos and signed
  PDFs are excluded (`libraryWhere`). Uploads and moves into `/chat` are
  refused. Uploading a name that already exists in the folder offers "Add as
  a new version" or "Keep both".
- **Versions.** `FileObject` always points at the current object;
  `FileVersion` rows hold every version once a second one exists (the first
  is synthesised from the file until then). Restoring copies the old object
  into a new version. The newest 20 versions are kept; older objects are
  pruned when a version is added.
- **Deletion.** Soft delete (`deletedAt`); restorable for 30 days, then
  `lib/scheduled/docsFiles.ts` purges rows, versions and objects (skipping
  workspaces on legal hold, rows claimed with `FOR UPDATE SKIP LOCKED`).
- **Usage.** Files, storage used (current plus older versions), older
  versions and trash, by kind; chat attachments are left out.

## Integrations

- Search: WORKSPACE, non-archived pages are indexed as `doc`; library files
  as `file` (title = file name). Admin-only and archived pages are removed.
- Activity: `created`, `edited` (once per editing session), `archived` for
  pages; `uploaded` for library files.
- Audit: `doc.created|moved|visibility_changed|archived|restored|duplicated|revision_restored|verified|verification_cleared|exported`,
  `file.uploaded|version_added|renamed|moved|linked|deleted|restored`.
- Notifications: `mention` (sourceType `doc`) through `dispatch` for people
  newly @-mentioned in a page who can see it.
- Realtime (ids only): `docs.tree_changed` on `workspace`, `doc.updated`,
  `doc.archived`, `doc.presence` on `doc:<id>` (audience = admins for
  admin-only pages), `files.changed` on `workspace`.

## Known gaps for the coordinator

- No `doc.verification_due` event in `lib/notify/events.ts`, so lapsed
  verifications are shown on the docs home but not pushed. Adding the event
  (personal, recipients = `verifiedById ?? createdById`) lets
  `lib/scheduled/docsFiles.ts` dispatch it.
- `SearchDocument.visibility` has no ADMINS value, so admin-only pages are
  not in global search (docs search covers them for admins).
- `scripts/seed-demo.mjs` has no registry hook; run
  `node --env-file-if-exists=.env scripts/seed/docsfiles.mjs` after it, or
  import it from the demo seed.
