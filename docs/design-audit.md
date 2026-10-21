# Design fidelity audit

Date: 21 October 2026. Branch: `feat/design-fidelity`.

Sources: the refreshed local Space Works Design `tokens/tokens.css` and `tokens.json`, UI brand spec A–K, core and long-tail UX specs, brand site content and mascot guide; Space Works Events primitives, styles, design guide and brand tests. Colour values follow the refreshed token files when the older spec table disagrees.

Status meanings: **Pass** = checked in source or automated verification; **Fixed** = corrected in this change; **Owner** = needs new approved artwork or a source-policy decision. These are source and rendering-contract checks. No browser, screenshot, mobile-device or screen-reader session was run, as requested. They do not constitute a visual sign-off for every screen.

## Brand checklist (§K)

| Rule | Status | Where / enforcement |
| --- | --- | --- |
| 1. Supplied logo masters | Pass | Logo component selects unchanged `/brand/logo` artwork. Tests check every variant exists. |
| 2. Clear space H/4 | Fixed | Logo clear space is on by default. Patch also owns its clear space. SSR tests check padding. |
| 3. Keep lockups intact | Pass | SVG masters remain single images; no CSS reconstruction of the symbol and wordmark. |
| 4. Symbol at least 48px | Fixed | Horizontal and symbol artwork clamps; compact bars use the symbol instead of a shrunken lockup. |
| 5. Primary lockup at least 180px | Pass | Stacked clamp; desktop sidebar draws it at 180px. Auth artwork is about 248px wide. |
| 6. Dedicated small-size master | Owner | Existing app-icon remains the interim favicon asset. A dedicated small-size master must come from the brand owner. |
| 7. App icon on cream tile | Pass | Existing app-icon masters and raster icons retained; no new image pipeline or exports. |
| 8. Approved light/dark pairings | Fixed | Adaptive reversed artwork; dark-band selectors now include Patch and logos. |
| 9. No logo effects or distortion | Pass | Images keep master proportions; no artwork files were edited. No filters or transforms were added to them. |
| 10. Product naming | Pass | Space Works in copy; technical identifiers preserved. |
| 11. Canonical colours | Fixed | Every light/dark triplet is pinned in `palette.css` and checked against the source fixture. Legacy aliases now reference canonical colours rather than extra surface mixes. |
| 12. Readable pairs, no orange text | Fixed | Contrast matrix tests; dark links use accent text rather than action fill. Tab underlines, selection boundaries and progress marks use the readable accent ink. Internal orange emphasis and counters become teal. Public emphasis tokens remain available. |
| 13. Status includes a word | Pass | Required Chip content; existing enum labels preserved, table statuses remain text. No colour-only state was introduced. |
| 14. Gilroy, one expressive moment | Fixed | Removed raw Unbounded from auth alongside Patch. No routed app component uses `font-accent`. |
| 15. Type scale | Fixed | Supplied 400/500/600/700 faces; 32px stats, 20px panels, 16/14/12px reading scale. Source guard rejects arbitrary pixel type sizes. |
| 16. Clear IDs and codes | Fixed | Gilroy, tabular figures and slashed zero replace monospace code. Numbers inherit tabular figures globally. |
| 17. Approved lucide set / names | Fixed | Only §G icons are imported. Optional decoration removed; formatting, visibility and close controls use short text. Icon controls retain accessible names. |
| 18. Grid, flat cards, one bold moment | Fixed | 10px controls, 16px cards, 12px data-table container, 1px borders, no card elevation. Nested empty panels stay quiet; primary page states opt into Patch. |
| 19. Voice and next steps | Fixed | Copy guard bans vague errors and progress-label ellipses, with a narrow exception for the retained GitHub streaming status “Loading pull requests and issues…”. Ellipses otherwise remain on confirmation actions. Filtered project state offers Clear filters; assistant empty state has one prompt-menu action and keeps all suggestions. |
| 20. Calm app shell and lists | Fixed | Text-only Citron nav, teal current item, pinned account menu, independent nav scrolling, Citron search, bordered tables. Literal multiple header primaries are guarded. |
| 21. Light / Dark only | Fixed | Appearance selector offers exactly Light and Dark. Unset preference still follows the device without a third UI choice. |

## Layout and shared behaviour

| Surface | Status | Change |
| --- | --- | --- |
| AppShell | Fixed | 256px Citron rail, 44px items, independent scroll, 180px stacked master; 72px mobile bar with 48px symbol. |
| DashboardLayout | Fixed | Home uses shared geometry: four stats, 260px activity rail, rail below main on small screens. |
| ListLayout | Fixed | Shared minimum widths and wrapping; operations, collaboration, funding and marketing adopt it. |
| DetailLayout | Fixed | Shared back link, 280px optional aside and responsive body; announcement detail adopts it. |
| SettingsLayout | Fixed | Shared header/tabs/content; existing settings rows retain server-side permission checks. |
| FormPageLayout | Fixed | Shared form geometry with optional 300px preview; announcement forms adopt it. |
| Auth / centred card | Fixed | Split sign-in/setup has one Patch moment. Recovery, invite and step-up routes use a centred card. |
| Public / system states | Fixed | Existing public tenancy gates retained; global error now uses Gilroy, tokens, the master symbol and Patch. |
| Tables | Fixed | All authored JSX data tables use the shared primitive, including reports, availability, notifications, costs, invoices and chart alternatives. 48px cells, sentence-case accent headers, bounded horizontal scroll and keyboard-focusable regions. |
| Forms / choices | Fixed | 44px buttons, icon controls, menu rows, selects, filter chips and segmented choices. Checkbox/radio hit areas are enlarged while their visual marks remain 20px. Product operations uses the shared Dropdown. |
| Tabs | Fixed | Underline treatment retained; labelled 44px overflow controls; selected tab stays visible on route/selection changes. |
| Overlays | Fixed | Shared ink scrim, overlay-only shadow, 240ms enter. Dialogs become bottom sheets on phones; task drawer explicitly retains full-height geometry. |
| Motion | Fixed | 120/200/240ms UI motion, no hover wiggle or lift, reduced-motion override, still image for animated Patch. |
| Mascot | Fixed | Idle is still. All 60 route loading states delegate to the shared walking Patch with visible status text. Approved adaptive assets and clear space. Closed polls with quorum get the sneeze animation; no eligibility or tally logic changed. |
| Storage / security | Pass | No uploads, schema, tenancy queries, secrets or storage paths changed. Brand artwork remains static supplied product assets. |
| Frontend boundary | Fixed | Shared layouts, the approval inbox and GitHub repository lists are presentation only. Project overview, Requests and Approvals resolve repository/inbox reads in page-local async sections under Suspense, so local content streams without waiting for those reads. Each fallback has `role=status`; project overview retains “Loading pull requests and issues…”. Source guards enforce the boundary and streaming; catalogue and generated types are regenerated. |

## Area coverage

Every `app/**` and `components/**` source was included in the static inventory and source guards. Shared fixes reach areas without individual page rewrites. The table below lists route coverage; each area inherits K1–5, K7–21 where applicable. K6 is the common owner item. Applicable rules are checked by source and tests, with visual verification outstanding for every area.

| Area | Page files | Status / specific coverage |
| --- | ---: | --- |
| `a` | 1 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `account` | 1 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `activity` | 1 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `admin` | 8 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `admin-mfa` | 1 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `announcements` | 4 | Fixed — form/detail layouts, state, links and emphasis |
| `app-reviews` | 4 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `assets` | 1 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `assistant` | 5 | Fixed — page states, single prompt menu action, labelled controls |
| `attendance` | 1 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `boardroom` | 2 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `calendar` | 2 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `catalogue` | 1 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `changelog` | 1 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `chat` | 4 | Fixed — approved icons, quiet counters, code typography and labelled controls |
| `contacts` | 5 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `cycles` | 2 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `dm` | 2 | Fixed — shared chat controls and page states |
| `docs` | 4 | Fixed — editor labels, type, tables and shared controls |
| `documents` | 4 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `escalation` | 1 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `f` | 1 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `files` | 3 | Fixed — page states, code preview and labelled controls |
| `finance` | 24 | Fixed — tables, stat figures, reports, chart labels, invoices, recurring costs and page states |
| `forgot-password` | 1 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `forms` | 2 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `funding` | 3 | Fixed — inherited tokens, shared list layout, numbers and record states |
| `goals` | 2 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `governance` | 7 | Fixed — record states, headers and inherited controls |
| `helpdesk` | 3 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `hiring` | 3 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `home` | 1 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `ideas` | 2 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `invite` | 1 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `it` | 1 | Fixed — shared marketing/IT list geometry and inherited controls |
| `leave` | 1 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `links` | 1 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `login` | 1 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `marketing` | 1 | Fixed — list geometry, links and inherited controls |
| `meetings` | 3 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `members` | 4 | Fixed — search, directory state, availability table and form links |
| `money-controls` | 2 | Fixed — tables, record states and inherited forms |
| `my-tasks` | 1 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `notepad` | 1 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `notifications` | 3 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `onboarding` | 1 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `organisation` | 1 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `organisations` | 1 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `pipeline` | 1 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `polls` | 2 | Fixed — page empty state and closed-with-quorum collective success |
| `product-ops` | 2 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `projects` | 10 | Fixed — board/list controls, task cards, status words, code typography and shared empty states |
| `requests` | 2 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `reset-password` | 1 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `responsibilities` | 1 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `rota` | 2 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `safeguarding` | 1 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `safety` | 5 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `search` | 1 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `seo` | 1 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `services` | 12 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `settings` | 15 | Fixed — shared settings layout, forms, labels, invitations and tabs |
| `setup` | 1 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `sign` | 2 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `social` | 4 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `status` | 1 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `subscriptions` | 1 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `t` | 1 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `teams` | 2 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `templates` | 1 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `vault` | 1 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `volunteering` | 3 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |
| `workspace-picker` | 1 | Pass / shared fixes — tokens, primitives, links, states, approved icons and tables where used |

## Owner items and limits

1. The refreshed canonical dark palette differs from the older A.1 table. The task explicitly chooses the token files; this pass pins those values. The brand repository should reconcile its prose table.
2. The brand owner still needs to supply a dedicated sub-48px logo asset. Existing favicon/app-icon files are retained.
3. Browser and assistive-technology verification was excluded. Responsive geometry is implemented and statically checked, but 375px rendering, keyboard traversal and actual screen-reader output need a later visual/device review. Dense tables retain bounded scrolling rather than inventing a separate mobile data model.
4. The mandatory broad text scan also matches existing notepad model names in the baseline. This UI pass does not rename persisted Prisma models or historical migrations to suppress those false positives. The commit-message scan is clean.

## Scope and logical changes

Changes are intentionally uncommitted. Suggested review groups:

1. `fix(design): align canonical palette and typography` — palette, stable aliases, type, search, motion, dark links and documentation.
2. `fix(design): align chrome and accessible primitives` — logos, auth/centred cards, targets, table adoption, approved icons, layouts and page states.
3. `feat(design): celebrate collective poll outcomes` — existing closed/quorum view plus adaptive Patch animation.
4. `test(design): guard brand fidelity and refresh frontend contracts` — source/SSR/contrast tests, fixture, catalogue, generated DTOs and stale-view cleanup.
5. `fix(core): close project permission helper` — one missing closing brace already absent in the baseline `lib/roles.ts`; required for compilation and test imports. No permission expression was changed.
6. `test(finance): isolate statutory proof fixtures` — the private-download test selects a non-salary-tax remittance, leaving the salary-tax bill without proof for the subsequent challan requirement test. This removes dependence on unordered database results; production finance code is unchanged.

Cross-cutting ownership: `app/**`, `components/**`, styles, design tests and docs are this task's explicit UI scope. Outside that scope, the syntax repair in `lib/roles.ts`, the one-field fixture isolation in `tests/integration/recurring-costs.db.test.ts`, and mechanically generated frontend contracts/registry/views are changed. No README, deployment file, schema, migration, analytics, secrets-manager or CLI source was edited. No seed module is needed: the only new product moment uses existing poll data.

Generated files outside UI ownership, required by the frontend task:

- `frontend/catalog.json`, `frontend/pages.json`: reader catalogue and rendering templates.
- `frontend/contracts.d.ts`, `frontend/model-types.d.ts`, `frontend/model-types.json`: transport and shared presentation types.
- `lib/frontend/registry.ts`, `lib/frontend/resources.ts`: generated backend dispatch and resources.
- `lib/views/generated/w-workspaceSlug-projects-key-project-overview-page-loadProjectOverviewPage.ts`, `lib/views/generated/w-workspaceSlug-requests-approvals-page-loadApprovalsPage.ts`, `lib/views/generated/w-workspaceSlug-requests-page-loadRequestsPage.ts`: page loaders return local data; rendering templates resolve the separate guarded repository/inbox readers under Suspense. No stale generated readers remain.

## Verification

Checks run serially to fit the shared 8 GB host. Typecheck and builds use `NODE_OPTIONS=--max-old-space-size=4096`. Test commands use one worker and a 120-second setup timeout; unit cases allow 120 seconds and integration cases 60 seconds.

| Check | Result |
| --- | --- |
| `npm run db:deploy` | Pass; all 20 migrations applied to `sww_design` |
| `npm run db:test:prepare` | Pass; all 20 migrations applied to disposable `sww_design_test` |
| `npm run lint -- --max-warnings=0` | Pass; zero warnings |
| `npm run typecheck` | Pass |
| `npm run test:unit` with serial/time limits above | 85 files passed; all 1,216 tests passed, including 15 design checks and Redis pub/sub on DB 14 |
| `npm run test:integration` with serial/time limits above | 53 files passed; all 603 tests passed, including private object-storage proofs in Silo bucket `sww-design` |
| `npm run frontend:catalog` | Pass; 546 transport types and 45 shared UI types; source stamp matches; no stale readers |
| `node scripts/check-frontend-boundary.mjs` | Pass; no page reaches `lib/db` |
| `npm run build` | Pass; production compilation, TypeScript, page generation and standalone output |
| `npm run typecheck:frontend` | Pass; boundary, workspace preparation, route generation and frontend TypeScript |
| `npm run build:frontend` | Pass; production build and dependency traces contain no database engine, mail, Redis or storage client |

Root and frontend `.next` build outputs were removed after verification. No browser or Docker command was run. Changes remain uncommitted as requested; there are no new stubs.

Earlier integration attempts hit expired setup transactions while compilers were running. The isolated finance file then passed all 29 tests, followed by green full serial suites. Enabling Silo exposed the pre-existing remittance-fixture collision described in review group 6; with that fixture isolated, all 603 integration cases pass. Service-enabled final suites have no skips. The optional TypeScript diagnostic trace was stopped after source checking and cache emission; the normal typecheck command subsequently exited successfully.

Both mandatory text scans were run. The commit-message scan is clean. The tracked-source scan reports 31 pre-existing notepad model-name matches, compared with 31 on `dev`; the file/content comparison finds zero new matches. No forbidden branding was added. See owner item 4.

## Review follow-up: streamed guarded reads

The project overview repository list and both Requests inboxes now resolve their guarded readers in async sections declared in the calling page files. Suspense lets local page content render while those sections load. Shared repository/inbox components remain presentation only; generated page loaders no longer await either reader. The design source guard checks both authored and generated streaming boundaries and preserves the exact GitHub `role=status` fallback.

Follow-up verification: `npm run frontend:catalog`, `node scripts/generate-frontend-catalog.mjs --check`, zero-warning lint, root typecheck (4 GB heap), frontend typecheck/boundary check, and `git diff --check` pass. The targeted design/frontend/page-guard suite passes all 226 tests in five files. The full unit run passes 84 files and 1,207 tests, with 11 skipped; `monitor-network.test.ts` fails its local-listener setup because this sandbox rejects `listen` on `127.0.0.1` with `EPERM`. An additional production build was attempted and interrupted after remaining in the compile stage for several minutes without further output; it did not complete. No data or permission logic changed, so integration tests were not rerun. Changes remain uncommitted.
