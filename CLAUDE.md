# Claude guidance for Space Works Workspace

Read and follow [`AGENTS.md`](AGENTS.md) in full before making changes. It is
the canonical guide: product, repo map, Next.js 16 rules, the Server Action
pattern, tenancy and security rules, the shared services, verification and
branching.

Quick pointers:

- Data model: `prisma/schema.prisma` (complete for every product area).
- Shared services and their signatures: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
- Brand and UI rules: [`docs/DESIGN.md`](docs/DESIGN.md).
- Every hand-written file (source, tests, scripts, CSS) is at most 300 lines.
  Split by responsibility; never compress lines to fit. Generated files, the
  Prisma schema, migrations and lockfiles are exempt. See AGENTS.md.
- Never read, print or commit `.env`; use `.env.example` for names.
- Feature work goes on `feat/<short-name>` from `dev`; only @Shaan-Shoukath merges to `main`.
- Local demo data: `DEMO_PASSWORD=... npm run db:seed:demo` seeds "TinkerSpace Kochi".
