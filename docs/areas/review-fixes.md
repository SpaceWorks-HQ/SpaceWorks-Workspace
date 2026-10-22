# Final review fixes

Targeted corrections on `feat/review-fixes`. No schema, deployment, seed or dependency changes.
Changes are intentionally uncommitted for review.

## Findings and proposed logical commits

| Proposed commit | Findings | Changes |
| --- | --- | --- |
| `fix(search): enforce live source access for private results` | 1, 3, 8 | Notes require their owner before any admin override and a live, unarchived source. Assistant file results pass the download authorization check; jobs cannot recover private files with their creator's broader rights. Global search, activity and resource checks also verify live file access. Active profiles and visible teams have tenant-bound source predicates; suspended or disabled people and archived teams are excluded. |
| `fix(files): preserve area-owned files and legal holds` | 2, 7 | Shared library predicates exclude purchase attachments, reimbursement receipts and asset photos, including trash and every library mutation. Purge takes workspace locks in stable order before file locks, rechecks legal hold and references, and excludes area-owned files before limiting a batch. File search metadata includes the source task's project, team and visibility. |
| `fix(notepad): preserve concurrent and rejected edits` | 5, 6 | The note mutation compares the expected timestamp atomically with the update; a zero count returns the conflict message. The timestamp always advances and indexing shares the transaction. The editor serializes saves, merges rejected changes back behind newer pending fields, waits for successful flush before closing or archiving, and offers Copy my version, Reload and a retry for transient errors. |
| `fix(tasks): respect live calendar access and canonical links` | 4, 9 | Personal feeds intersect assignments with current task access and exclude archived projects. Assistant results and search entries use the shared task detail URL helper. Calendar task links use that helper too. |

Regression coverage lives in `tests/integration/review-fixes.db.test.ts`,
`tests/unit/notepad-saving.test.ts` and `tests/unit/assistant-tools.test.ts`.
The database tests use real PostgreSQL authorization and concurrency; object
removal is mocked because these fixtures create rows without S3 objects.
The client tests exercise the same save session used by the editor.

## Pattern audit

- SearchDocument readers: the search page and command palette share
  `searchDocuments`; API v1 and MCP execute the shared assistant tools.
  Both readers enforce note ownership. Assistant search also verifies the
  source note, and scheduled jobs omit personal note hits.
- File array references: purchase requests, reimbursements and asset photos
  are the schema's file-id arrays. All three remain with their owning area.
  Approvals refer to their subject records rather than holding file arrays.
  Form fields do not support file uploads; contacts, app reviews and vault
  items have no implemented FileObject attachment path. Existing relational
  exclusions for chat, ledger receipts, covers, contracts, evidence, logos
  and signed PDFs remain in place.
- The same missing receipt authorization also affected global file search,
  activity summaries and polymorphic resource checks; these now use live
  download authorization. Private-team file metadata is indexed correctly,
  while stale metadata is still checked against the source at read time.
- The calendar also had outdated project and projectless task URLs; both now
  use the canonical helper along with assistant task results and indexes.
- Version-check searches found note saves and docs saves. Docs already use
  an atomic timestamp predicate inside the revision transaction; messaging
  credential updates also use a conditional timestamp predicate. No other
  non-atomic optimistic version check was found.

## Verification and limits

The application and disposable test databases were migrated with `db:deploy`
and `db:test:prepare`. Run lint, typecheck with the specified 4096 MB heap,
all unit tests and only the new integration file. The full integration suite
and production build are intentionally excluded by this task's memory limit.
Lint and typecheck pass. The targeted integration file passes all 14 tests;
13 of these fail against the original HEAD in a temporary source snapshot.
The full unit suite passes all 876 tests across 62 files with
`TEST_REDIS_URL=redis://127.0.0.1:6395/9`, including the Redis pub/sub test.
Typecheck used `NODE_OPTIONS=--max-old-space-size=4096`; generated `.next`
artifacts were removed afterwards.

No feature behavior is stubbed. This pass does not include a browser viewport
or screen-reader run; recovery controls use the existing buttons and dialog,
a wrapping layout, live save status and an alert for save failures.

The required history branding check is clean. The repository branding pattern
also matches the pre-existing personal-note model name as a substring; this
was present in HEAD and cannot be eliminated without renaming the schema and
its existing consumers, outside this targeted repair.
