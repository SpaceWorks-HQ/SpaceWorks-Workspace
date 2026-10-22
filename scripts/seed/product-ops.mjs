/** Manual engineering and grant-budget examples for an Indian community team. Safe to run again. */
export default async function seedProductOps(prisma, { workspaceId, users }) {
 const ownerId = users.admin?.id ?? users.owner.id, backupOwnerId = users.owner.id;
 let project = await prisma.project.findFirst({ where: { workspaceId, key: "SOLAR" } });
 if (!project) project = await prisma.project.create({ data: { workspaceId, key: "SOLAR", name: "Community solar workshop", description: "Prototype a solar demonstration for the operating team and prepare a funding budget.", ownerId } });
 const columns = [];
 for (const [name, category, position] of [["To do", "TODO", 0], ["Building", "IN_PROGRESS", 1], ["Done", "DONE", 2]]) {
  let column = await prisma.boardColumn.findFirst({ where: { projectId: project.id, name } });
  if (!column) column = await prisma.boardColumn.create({ data: { projectId: project.id, name, category, position } });
  columns.push(column);
 }
 let opportunity = await prisma.fundingRecord.findFirst({ where: { workspaceId, kind: "OPPORTUNITY", title: "Community solar workshop funding" } });
 if (!opportunity) opportunity = await prisma.fundingRecord.create({ data: { workspaceId, kind: "OPPORTUNITY", title: "Community solar workshop funding", status: "APPLYING", ownerId, createdById: ownerId, dueOn: new Date("2026-11-15"), details: { source: "CSR", year: 2026, askedMinor: 30000000, nextAction: "Attach the reviewed prototype budget." } } });
 const fund = await prisma.financeFund.upsert({ where: { workspaceId_name: { workspaceId, name: "Community solar demonstration" } }, create: { workspaceId, name: "Community solar demonstration", currency: "INR", restricted: true, notes: "Illustrative funding proposal; no procurement or ledger entries." }, update: {} });
 let budget = await prisma.budget.findFirst({ where: { workspaceId, name: "Solar prototype proposal 2026" } });
 if (!budget) budget = await prisma.budget.create({ data: { workspaceId, name: "Solar prototype proposal 2026", projectId: project.id, periodStart: new Date("2026-10-01"), periodEnd: new Date("2027-03-31"), amountMinor: 30000000, currency: "INR", createdById: ownerId } });
 const save = async (kind, title, details, extra = {}) => {
  const existing = await prisma.productRecord.findFirst({ where: { workspaceId, kind, title } });
  return existing ?? prisma.productRecord.create({ data: { workspaceId, kind, title, status: "PLANNED", ownerId, createdById: ownerId, projectId: project.id, notes: "Illustrative manual record for the community operating team.", details, ...extra } });
 };
 let idea = await prisma.idea.findFirst({ where: { workspaceId, title: "Portable solar demonstration panel" } });
 if (!idea) idea = await prisma.idea.create({ data: { workspaceId, title: "Portable solar demonstration panel", bodyMd: "A safe teaching prototype for the community office team.", authorId: ownerId, status: "PLANNED" } });
 const now = await save("ROADMAP", "Build the first solar demonstration", { horizon: "NOW", quarter: "2026-Q4", ideaId: idea.id, outcome: "A tested prototype and a clear funding budget." }, { status: "IN_PROGRESS", dueOn: new Date("2026-11-10") });
 await save("ROADMAP", "Improve the inverter enclosure", { horizon: "NEXT", quarter: "2027-Q1", outcome: "Safer cable routing and easier access for test work." });
 await save("ROADMAP", "Publish the internal build guide", { horizon: "LATER", quarter: "2027-Q2", outcome: "Help the next operating team maintain the demonstration." });
 const release = await save("RELEASE", "Solar demonstrator first build", { version: "0.1.0", scope: "A bench-tested solar demonstration with a reviewed budget.", taskIds: [], roadmapIds: [now.id], checklist: [{ title: "Review wiring and fuse sizing", done: false, note: "Ask the technical owner to check." }, { title: "Confirm rollback and safe isolation", done: false, note: "" }], releaseNotes: "First internal solar demonstration prototype." }, { status: "DRAFT", dueOn: new Date("2026-11-15") });
 await save("QA_RUN", "First build bench QA", { environment: "Kochi community office test bench", checklist: [{ title: "Verify protective earth continuity", done: false, note: "" }, { title: "Check inverter under a dummy load", done: false, note: "" }], findings: "Complete the safety checks before approving the release." }, { status: "OPEN", releaseId: release.id, dueOn: new Date("2026-11-12") });
 await save("ISSUE", "Inverter display restarts under test load", { type: "BUG", severity: "HIGH", steps: "Connect the dummy load, then start the inverter. The display restarts.", expected: "Display remains on and reports the load.", environment: "Bench prototype, inverter firmware 0.1", ideaId: "" }, { status: "OPEN", releaseId: release.id, dueOn: new Date("2026-11-05") });
 const estimate = await save("ESTIMATE", "Community solar workshop proposal budget", { contingencyBps: 1000, revisionNote: "Initial funding proposal with illustrative prices, not supplier commitments.", lines: [
  ["Copper wire", "6 sq mm insulated copper, 50 m", "ELECTRICAL", 50000, "metre", 12000, "Kochi electrical supplier", 1800],
  ["5 kVA generator", "Demonstration backup source", "ELECTRICAL", 1000, "each", 8500000, "Local generator supplier", 1800],
  ["Solar inverter", "5 kVA hybrid inverter", "ELECTRONICS", 1000, "each", 4500000, "Kochi solar supplier", 1200],
  ["Mounting frame", "Galvanised frame and fixings", "STRUCTURAL", 1000, "set", 1800000, "Community fabrication partner", 1800],
  ["Installation labour", "Electrical installation and safety testing", "LABOUR", 3000, "day", 250000, "Local installation team", 0],
 ].map(([item, specification, category, quantityMilli, unit, unitCostMinor, supplier, gstBps]) => ({ item, specification, category, quantityMilli, unit, unitCostMinor, supplier, gstBps, quoteUrl: "", quoteFileId: "" })) }, { status: "DRAFT", fundingId: opportunity.id, fundId: fund.id, budgetId: budget.id, dueOn: new Date("2026-11-10") });
 await prisma.productEstimateRevision.upsert({ where: { workspaceId_recordId_version: { workspaceId, recordId: estimate.id, version: estimate.revision } }, create: { workspaceId, recordId: estimate.id, version: estimate.revision, createdById: ownerId, snapshot: { title: estimate.title, notes: estimate.notes, currency: estimate.currency, projectId: project.id, fundingId: opportunity.id, budgetId: budget.id, fundId: fund.id, details: estimate.details, fileIds: [] } }, update: {} });
 const prototype = await save("PROTOTYPE", "Solar bench prototype", { version: "A", designRevision: "Move the DC fuse closer to the battery connection." }, { status: "TESTING" });
 await save("TEST", "Prototype A load test", { testPlan: "Run a protected dummy load for 30 minutes and log output voltage.", results: "Display restarted under load at minute 12.", findings: "Check supply cable termination and inverter firmware.", designRevision: "Re-route the DC supply cable before repeating the test." }, { status: "FAIL", parentId: prototype.id, dateOn: new Date("2026-10-20") });
 await save("CHANGE", "Update test bench inverter firmware", { environment: "Kochi test bench", changed: "Install the reviewed firmware build after saving current settings.", risk: "HIGH", rollback: "Restore the previous firmware and saved settings; isolate the bench if the display resets.", incidentId: "", requiresApproval: true }, { releaseId: release.id, dueOn: new Date("2026-11-08") });
 await prisma.serviceCatalogItem.upsert({ where: { workspaceId_slug: { workspaceId, slug: "solar-demonstrator" } }, create: { workspaceId, name: "Solar demonstrator control system", slug: "solar-demonstrator", kind: "DEVICE", environment: "DEV", ownerId, backupOwnerId: backupOwnerId === ownerId ? null : backupOwnerId, createdById: ownerId, description: "Internal prototype ownership and maintenance notes." }, update: {} });
}
