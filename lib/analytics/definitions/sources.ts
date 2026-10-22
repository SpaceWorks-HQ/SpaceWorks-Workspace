import "server-only";
export const ledgerDims = {
  fund: 'r."fundId"',
  centre: 'r."costCentreId"',
  project: 'c."projectId"',
  team: 'p."teamId"',
};
export const ledger = {
  table: '"LedgerEntry" r',
  join: 'LEFT JOIN "FinanceCategory" k ON k.id=r."categoryId" AND k."workspaceId"=r."workspaceId" LEFT JOIN "FinanceFund" f ON f.id=r."fundId" AND f."workspaceId"=r."workspaceId" LEFT JOIN "FinanceCostCentre" c ON c.id=r."costCentreId" AND c."workspaceId"=r."workspaceId" LEFT JOIN "Project" p ON p.id=c."projectId" AND p."workspaceId"=r."workspaceId"',
  date: 'r."occurredOn"',
  dateOnly: true,
  titleSql: "r.description",
  path: "'/finance/ledger?record='||r.id",
  unit: "money" as const,
  gate: "finance" as const,
  where: 'r."voidedAt" IS NULL AND NOT r."privatePayroll"',
  value: 'r."amountMinor"',
  dimensions: ledgerDims,
};
export const funding = {
  table: '"FundingRecord" r',
  date: 'r."dateOn"',
  dateOnly: true,
  titleSql: "r.title",
  path: "'/funding/'||CASE WHEN r.kind IN ('OPPORTUNITY') THEN 'tracker' WHEN r.kind IN ('DONATION','DONOR','CAMPAIGN','PLEDGE','RECEIPT_SETTINGS') THEN 'donations' WHEN r.kind IN ('PROGRAMME','KPI','IMPACT_ENTRY') THEN 'impact' ELSE 'grants' END||'?edit='||r.id",
  gate: "admin" as const,
  where: 'r."archivedAt" IS NULL',
  dimensions: {
    fund: 'coalesce(r."fundId",(SELECT parent."fundId" FROM "FundingRecord" parent WHERE parent."workspaceId"=r."workspaceId" AND parent.id=r."parentId"))',
    programme: `coalesce(nullif(r.details->>'programmeId',''),(SELECT CASE WHEN parent.kind='PROGRAMME' THEN parent.id ELSE nullif(parent.details->>'programmeId','') END FROM "FundingRecord" parent WHERE parent."workspaceId"=r."workspaceId" AND parent.id=r."parentId"),(SELECT programme.id FROM "FundingRecord" parent JOIN "FundingRecord" programme ON programme.id=parent."parentId" AND programme."workspaceId"=parent."workspaceId" WHERE parent."workspaceId"=r."workspaceId" AND parent.id=r."parentId" AND programme.kind='PROGRAMME'))`,
  },
};
export const people = {
  table: `(SELECT mb.id,mb."workspaceId",mb."userId",mp."engagementStart",coalesce(mp."engagementEnd",mp."leavingAt") AS "leavingAt",mp."departmentId",coalesce(mp."membershipType"::text,'Not recorded') AS "membershipType",coalesce(mp."engagementType",'Not recorded') AS "engagementType",mb."joinedAt" AS "createdAt" FROM "Membership" mb LEFT JOIN "MemberProfile" mp ON mp."workspaceId"=mb."workspaceId" AND mp."userId"=mb."userId") r`,
  join: 'JOIN "Membership" m ON m."workspaceId"=r."workspaceId" AND m."userId"=r."userId" JOIN "User" u ON u.id=r."userId" LEFT JOIN "Department" dep ON dep.id=r."departmentId" AND dep."workspaceId"=r."workspaceId"',
  date: 'r."engagementStart"',
  dateOnly: true,
  titleSql: "coalesce(u.name,'Former member')",
  path: "'/members/'||r.\"userId\"",
  person: 'r."userId"',
  dimensions: { team: "NULL::text" },
};
export const task = {
  table: '"Task" r',
  join: 'LEFT JOIN "Project" p ON p.id=r."projectId" AND p."workspaceId"=r."workspaceId"',
  date: 'r."createdAt"',
  titleSql: "r.title",
  path: "CASE WHEN p.key IS NULL THEN '/my-tasks/'||r.number ELSE '/projects/'||p.key||'/tasks/'||r.number END",
  where: 'r."archivedAt" IS NULL',
  permission: "task" as const,
  dimensions: { project: 'r."projectId"', team: 'p."teamId"' },
};
export const product = {
  table: '"ProductRecord" r',
  join: 'LEFT JOIN "Project" p ON p.id=r."projectId" AND p."workspaceId"=r."workspaceId"',
  date: 'r."createdAt"',
  titleSql: "r.title",
  path: "'/product-ops/'||CASE r.kind WHEN 'ISSUE' THEN 'issues' WHEN 'RELEASE' THEN 'releases' ELSE 'estimates' END||'?edit='||r.id",
  where: 'r."archivedAt" IS NULL AND (r."projectId" IS NULL OR p.status<>\'ARCHIVED\')',
  dimensions: {
    project: 'r."projectId"',
    team: 'p."teamId"',
    fund: 'r."fundId"',
  },
  permission: "project" as const,
};
export const help = {
  table: '"HelpTicket" r',
  date: 'r."createdAt"',
  titleSql: "r.title",
  path: "'/helpdesk/'||r.id",
  permission: "help" as const,
  label: "r.priority::text",
};
export const marketing = {
  table: '"MarketingItRecord" r',
  date: 'r."dateOn"',
  dateOnly: true,
  titleSql: "r.title",
  path: "CASE WHEN r.kind IN ('CONTENT','PROPOSAL') THEN '/marketing' ELSE '/it' END||'?tool='||r.kind||'&edit='||r.id",
  where: 'r."archivedAt" IS NULL',
};
