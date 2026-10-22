# Documents

Internal manual tools at `/w/[workspaceSlug]/documents`: one register for controlled invoices, receipts, vouchers, notes, donation certificates, utilisation statements and people letters. Knowledge pages remain at `/docs`. Existing commercial invoices remain explicitly labelled legacy invoices; they are never relabelled as statutory GST documents. Their detail screen can prepare a linked Documents draft, and the main invoice creation action opens Documents.

## Everyday use

Complete the existing legal entity in Governance, then open Documents → Tax settings and templates. The additional defaults live on that legal entity, rather than in a second identity model. Register each GSTIN/state/address/validity, donation approval and FCRA/VAT registration separately. Add authorised signatories, private logo/signature images, effective-dated item/rate favourites and approved letter wording. A signature image is a visual mark, not a cryptographic signature. The bundled Gilroy PDF font supports its Latin character set; issuance rejects unsupported characters instead of silently changing legal text. Keep an externally prepared multilingual copy as evidence where needed. Payment details require an explicit verification checkbox before a UPI instruction appears.

Create a draft, choose existing CRM/source/person references where available, enter recipient and supply facts, add source files, review and issue. Supported variants include commercial and GST tax invoices, bills of supply, receipt/refund/payment vouchers, linked credit/debit notes, ordinary payment/donation receipts, customer refunds, donation certificates, separate FCRA receipts, CSR/government utilisation working certificates, appointment/volunteer/internship/experience/NOC/participation letters and country-selected international fallbacks. Template merge fields are person, start, end, role, programme, hours, signatory and date. Correct letters through a new numbered copy linked to the original.

Source drafts can be opened with `sourceType=INVOICE|LEDGER|FUND|FUNDING&sourceId=...`; `personId=...` supplies engagement facts. Other source links are resolved against the workspace before saving. Underlying money is entered once: neither issuing a document nor allocating a receipt posts a ledger entry. A receipt can allocate cash and withholding separately across invoices; multiple receipts can settle one invoice. Withholding never becomes cash. Refunds freeze the cash allocations they reverse, reopening the correct invoice balance without changing the original receipt or allocation rows. Local cancellation never reverses a bank transaction; retained refund history and current balances reflect the controlled document status. Credits remain separate from cash refunds. Credits reduce receivables; refunds retain a separate numbered record linked to the receipt. The register displays balances and 0–30, 31–60, 61–90 and 90+ day bands. Personal follow-up reminders go only to active finance administrators through `dispatch()`.

Utilisation certificates link an existing fund and freeze its period ledger schedule. Receipts plus interest, and expenditure plus returned funds, must match that schedule so interest and refunds are not counted twice. Restricted payroll rows are aggregated rather than exposing individual salary postings. Opening funds, interest, refunds, advances, sanction details, component schedules, outcomes and reviewed certification wording remain manual entries. Use the sanctioning authority/agreement's current wording and obtain the required finance-head, organisation-head and CA signatures externally where applicable. Upload the signed certificate alongside the working copy.

## Controlled issue

Draft → Reserved (when manual IRP registration is required) → Issued → Cancelled. Normal documents pass through reservation inside the issue transaction. A workspace advisory lock serialises drafts, number allocation, issuance, corrections and allocations; the finance lock also serialises issue against closed periods. Indian fiscal years run April–March. Other profiles configure their fiscal start month. Series are per document type, registration and financial year. Defaults include a short registration discriminator; customised prefixes must remain unique. GST numbers contain only allowed characters and at most sixteen characters. Counters never reset after allocation; series can be locked. Rollbacks consume no number, retries return the issued record, cancellations retain their number and artifact.

Issuance validates document-specific facts and freezes identity, registration, signatory, inputs, calculated lines, source schedule, wording, calculation policy and template version. PostgreSQL triggers protect issued/cancelled facts, reserved payloads, evidence links and accepted filing snapshots. Issued documents have no edit/delete endpoint. Cancellation requires a reason, keeps the original PDF and refuses settled documents. Local cancellation never represents a bank reversal, external IRP cancellation or amended filing.

Amounts use bounded integer minor units and currencies. Quantity/rate calculations use exact integer rational arithmetic with half-up rounding. Discounts precede tax; taxable value, CGST, SGST/UTGST, IGST, VAT, cess and final round-off remain separate. A reviewed place-of-supply determination chooses components, with a reviewed manual override and reason. Reverse-charge tax remains outside the supplier's collectible total. Exempt lines and bills of supply collect no GST. Rates and HSN/SAC values are editable data, including historical and special rates. Indian GST documents require values prepared in INR; retain foreign-currency originals and the reviewed conversion basis as attachments. International fallback documents retain their selected currency. INR words use lakh/crore and paise. The existing signed-Int money ceiling remains 2,147,483,647 minor units per total.

For an IRP-scoped document, reserve/freeze the number before manual portal submission. Final issue requires the imported IRN, acknowledgement and timestamp plus the actual official QR image and signed JSON. The QR image is embedded separately from any UPI payment QR. A pasted IRN alone cannot complete issue. This records manually reviewed evidence; it does not verify the government's signature or call an IRP. Retain e-way-bill references and portal evidence as source attachments.

## Donation controls and filing

Ordinary donation acknowledgements explicitly disclaim statutory deduction-certificate status. Statutory certificates require separate reviewed donation approval, validity on the donation date, approval order, PAN, donor identity/address, correct deduction-section mapping and an imported portal acknowledgement/Pre-ARN. Cash above INR 2,000 and in-kind donations cannot carry an ordinary deduction certificate. Imported Pre-ARNs have unused/consumed status and cannot be reused, including after cancellation.

Legacy-period working exports use the 10BD/10BE adapter; donations from 1 April 2026 use the separate 113/114 adapter and category vocabulary. These are preparation CSVs, not a claim of portal-upload compatibility. Keep the official portal-generated certificate in the record's Official certificate files. Accepted manual filing batches freeze the included document snapshots, file hashes, manifest hash and portal acknowledgement; original documents cannot be included in another original batch. Corrections require a separate reviewed filing. Export the retained batches as JSON.

The register offers period CSV/JSON, GSTR-1 preparation/tax-component rows (including separately identified advance allocations, dated when entered), aggregated outward-supply HSN summaries with B2B/B2C separation (advances remain in the advance working tables), number-series counts, donation preparation exports and evidence ZIPs. CSV neutralises spreadsheet formulas. JSON is versioned and includes complete frozen snapshots and allocations. Evidence ZIPs include actual private files, their checksums and document audit history. Limits: 10,000 document rows per export, 1,000 files/100 MB per bundle, 2,000 ledger rows per utilisation certificate. Narrow the period when limits are reached. No output is labelled GST portal JSON.

## Files, delivery and privacy

All uploads and generated A4 PDFs use `uploadWorkspaceFile` and private Silo/S3 storage. No public or presigned object URLs are issued. Source images/PDFs support drag/drop, file selection and a separate phone-camera input, ten files per upload, 10 MB per file and 24 MB per batch. Raster images are decoded through the shared storage policy; signed JSON has a 2 MB limit. Image/PDF previews and downloads use the authorised file route. Record files and profile assets stay under reserved `/documents` folders, outside the general file library and its mutation/retention paths. Evidence is append-only after issue.

The existing paid-payslip generator registers its existing PDF in Documents; it is not reimplemented. Payroll files retain both the source finance attachment gate and the explicit live payroll grant. General document lists, search and exports exclude payroll. Owners/admins can prepare/issue financial documents, see donor tax identities, issue HR letters, cancel/correct documents, manage settings and prepare filing exports through separate capability helpers. Services re-read membership, suspension, disabled-account and archive state and scope all source/file lookups to the workspace. Search entries are PRIVATE/owner-scoped with a live administrator/source check. Audit/activity summaries and reminders contain generic text and ids, not donor IDs, salary data or certificate text.

Email delivery records the actual recipient, PDF id/hash and outbox id. The outbox attaches the frozen private PDF, rechecks the generating user's live authority at send time and checks the artifact checksum. It refuses cancelled documents and revoked permissions. Resends are intentional additional delivery records. Delivery status is read from the existing outbox; retained delivery history survives normal outbox cleanup.

Statutory document rows, snapshots and file references are excluded from ordinary purge/delete paths; their audit entries survive ordinary audit retention. Workspace legal hold continues to apply. Current policy conservatively retains controlled records indefinitely; there is no automated statutory-date deletion. Workspace deletion still cascades. Backups must retain database, objects and encryption keys; the evidence bundle is portable document evidence, not a full instance backup or a substitute for a restore drill.

## Integration boundaries and review

Funding tools now delegates receipt issuance to Documents in the same transaction. Existing funding receipts are backfilled with their original number and authoritative PDF; new receipts use the shared financial-year series. Funding donations and grants prefill Documents, retaining source proof hashes. Donation delivery rechecks CRM email consent and preference. Voiding a donation cancels its controlled receipts and certificates; replacement receipts require a cancelled original and correction link. Ordinary receipts do not claim tax deductibility: approved donation certificates have separate checks and portal evidence. Documents reuses CRM and finance funds/ledger rather than creating another fundraising register. Existing payroll operational slips remain subject to their documented jurisdiction limits; externally prepared statutory slips/certificates can be uploaded as evidence.

Templates require jurisdiction/applicability review. Government UCs are labelled working certificates, not a claim that arbitrary uploaded wording fulfils every sanction condition. EU/UK VAT and US acknowledgement fallbacks do not establish registration, national e-invoicing compliance or tax eligibility. There are no GST/IRP, accounting, banking, payroll or public/member-facing connectors. Future GST integration would need taxpayer authority, GSTIN/provider onboarding, secure credentials, tested/versioned schemas, signed-response verification, retry/deduplication, cancellation and reconciliation controls.

Implementation references checked against primary sources: [CBIC Rule 46](https://taxinformation.cbic.gov.in/content-page/explore-rules/1000136/1000001), [Income Tax 113/114 guidance](https://www.incometax.gov.in/iec/foportal/newformpage/forms/form113-114-faqs), [Income Tax registration guidance](https://www.incometax.gov.in/iec/foportal/newformpage/forms/Form%20105%20%26%20107-UM), and the [pdf-lib API](https://pdf-lib.js.org/docs/api/classes/pdfdocument).

## Verification and shared changes

Unit tests cover exact tax/rounding/discounts, fiscal boundaries, number limits, INR words, ageing, donation versions, merge fields, CSV escaping and capabilities. Database tests cover tenant isolation, forged roles, concurrency/retries, immutable snapshots, payment/TDS allocations, correction bounds, signed-QR requirements, restricted downloads, email attachment/hash retention, reminders, exports and purge protection. PDF samples are rendered and visually inspected without a browser. Mobile/accessibility use stacked layouts, bounded content, labelled controls, status words, keyboard controls and Patch in the main empty state; interactive browser/screen-reader testing is not run because this job prohibits browsers.

Outside the Documents folders: schema and one `20261020231000_documents` migration; role/nav integration; private file/library reservations; live search gate; notification catalogue/scheduler; outbox and email attachment transport; existing payslip artifact registration; legacy invoice entry points and generated frontend contracts/views. These are required shared-capability integrations. No README, deployment/release, Docker, other-worktree or main-checkout changes are made. Demo data is isolated in `scripts/seed/documents.mjs` and deliberately stays as a review-required draft with invented organisation references and no fake uploaded proofs.


Shared implementation changes include the funding receipt and delivery bridge, payroll PDF registration, private file/download checks, outbox attachment retention, legal-entity settings preservation, roles/navigation/search/reminders/retention, and a reusable ZIP writer. `lib/db.ts` preserves the transaction-client type identity on the root singleton to avoid pathological TypeScript structural comparisons after adding models; runtime construction is unchanged.


## Review handoff

Work is intentionally uncommitted. Suggested logical commits (each must carry the two requested co-author trailers):

1. `feat(documents): add controlled records, exact tax calculations and retained private evidence` — schema, the single Documents migration, domain services, privacy/retention integration and backend tests.
2. `feat(documents): add register, templates, issuing and finance/funding handoffs` — forms/pages, funding receipt bridge, payroll registration, navigation, generated frontend views and transport contracts.
3. `docs(documents): document manual filing, templates and review evidence` — this contract, demo module and verification evidence.

The working source incorporates the funding merge at `080d7c4`. The Git worktree index is not writable in this sandbox, so the branch reference remains at `6680bf1`; this is not a clean branch based on the integrated source. A feature-only patch is prepared at `/tmp/documents-review.patch`, relative to `080d7c4`, to avoid treating inherited funding files as new Documents changes. Shared `dev` advanced again to the jobs merge during final checks; that later job is not included in this review baseline. Do not commit the apparent upstream additions in the old index as Documents work.

Shared changes outside the Documents ownership paths:

- `prisma/schema.prisma`, `prisma/migrations/20261020231000_documents/migration.sql`: controlled records, composite tenant references, immutability/retention constraints and legacy funding receipt backfill.
- `lib/files.ts`, `lib/files/service.ts`, `lib/files/versions.ts`: enforce record permissions and protect reserved document files from the library.
- `app/actions/funding.ts`, `components/funding/Screen.tsx`, `lib/funding/receipts.ts`, `lib/funding/email.ts`, `lib/funding/service.ts`, `lib/funding/fields.ts`, `tests/integration/funding-tools.db.test.ts`: one receipt generator/number series, source links, consent-aware delivery, cancellation and retained proof checks.
- `lib/finance/tools/pdf.ts`, finance invoice list/detail pages: register existing payslips and provide Documents entry points for legacy invoices.
- `lib/governance/service.ts`: preserve Documents defaults when editing the shared legal entity.
- `lib/roles.ts`, `lib/nav.ts`, `lib/search/query.ts`, `lib/notify/events.ts`, `lib/scheduled/index.ts`, `lib/shell/retentionWriters.ts`: capabilities, navigation, live private search, due reminders and retained audits.
- `lib/outbox.ts`: preserve and deliver private PDF attachments through the existing outbox.
- `lib/shell/zip.ts`: binary evidence ZIP support while preserving existing JSON export behavior.
- `lib/db.ts`: retain the root client's transaction-delegate type identity to keep type checking tractable as the schema grows.
- Generated `frontend/{catalog.json,contracts.d.ts,model-types.d.ts,model-types.json,pages.json}`, `lib/frontend/{registry.ts,resources.ts}` and Documents/legacy-invoice generated view modules: required frontend workspace catalog refresh.

The required commit-message branding scan is empty because there are no new commits. The required tracked-tree scan still returns 31 inherited matches in the existing notepad model/callers/migration. The feature-only added-line scan is empty; historic schema names and migration files were not renamed for this feature. This inherited gate remains unresolved.


Final verification, 21 October 2026:

- `npm run db:deploy` and `npm run db:test:prepare`: 13 migrations, no pending migrations in the assigned finance databases.
- `npm run frontend:catalog`: 198 guarded views and 287 actions; no unreferenced generated view modules remained.
- `npm run typecheck:frontend` and `npm run typecheck`: passed with the 4 GB Node heap limit.
- `npm run lint`: passed with zero warnings.
- `npm run test:unit`: 74 files passed; 1,040 tests passed and one inherited test skipped.
- `npm run test:integration -- --testTimeout=60000`: 43 files and 463 tests passed. The longer timeout avoids machine-load failures in real PDF/concurrency cases.
- Documents and funding integration against the real `sww-documents` Silo bucket: two files and 48 tests passed, including all 34 Documents cases.
- `npm run build`: passed with the 4 GB Node heap limit; root and frontend `.next` directories removed afterward.
- Generated invoice, long invoice, refund, letter, donation certificate, utilisation certificate and imported-QR PDF samples were rendered and checked. The eight-page sample retains its final schedule item; the evidence ZIP contains 22 entries and passes integrity checks.
- `git diff --check`: passed. The commit-message branding scan is empty; the tracked-tree branding scan retains the 31 inherited matches described above. Added feature lines contain no new matches.

No external messages were sent, browser/Docker checks were not run, and no connector or GST/IRP integration was stubbed in. Filing remains manual as requested. Live SMTP delivery and interactive mobile/screen-reader validation were not performed. The source includes the complete tool implementation; Git metadata rebasing and the inherited branding gate remain handoff constraints.
