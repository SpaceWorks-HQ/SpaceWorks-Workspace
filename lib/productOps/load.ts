import "server-only";
import { prisma } from "@/lib/db";
import { canManageProductEstimates } from "@/lib/roles";
import { maxUploadBytes } from "@/lib/storage/policy";
import { hiddenTeamIds, teamScopeFilter } from "@/lib/teamAccess";
import { currentActor, visibleWhere, projectWhere, ensure, type Actor } from "./access";
import { recordsWhere, type Filters } from "./service";
import { SECTION_KINDS, type Section } from "./schema";
export async function loadProductOps(untrusted: Actor, section: Section, filters: Filters) {
 const actor = await currentActor(untrusted), workspaceId = actor.workspace.id, admin = canManageProductEstimates(actor.membership);
 if (section === "estimates") ensure(admin, "Ask an admin to manage funding estimates.");
 const where = await recordsWhere(actor, SECTION_KINDS[section], filters), visible = await visibleWhere(actor);
 const page = Math.max(1, Math.min(10000, Number.parseInt(filters.page ?? "1", 10) || 1));
 const [records, total, selected, choices, people, projects, ideas, funds, funding, budgets, services, incidents, tasks] = await Promise.all([
  prisma.productRecord.findMany({ where, orderBy: [{ dueOn: "asc" }, { createdAt: "desc" }, { id: "asc" }], take: 30, skip: (page - 1) * 30 }), prisma.productRecord.count({ where }),
  filters.edit ? prisma.productRecord.findFirst({ where: { AND: [visible, { id: filters.edit.slice(0, 64), kind: { in: SECTION_KINDS[section] } }] }, include: { attachments: { where: { file: { deletedAt: null } }, select: { generated: true, version: true, file: { select: { id: true, filename: true, contentType: true, size: true } } } }, estimates: { orderBy: { version: "desc" }, take: 100 }, children: { where: { workspaceId, archivedAt: null }, select: { id: true, title: true, status: true } }, releaseItems: { where: { workspaceId, archivedAt: null }, select: { id: true, title: true, status: true, kind: true } } } }) : null,
  prisma.productRecord.findMany({ where: { AND: [visible, { archivedAt: null, kind: { in: ["RELEASE", "ROADMAP", "PROTOTYPE"] } }] }, select: { id: true, title: true, kind: true, projectId: true, status: true, approvalId: true, shippedAt: true }, orderBy: { title: "asc" }, take: 1000 }),
  prisma.membership.findMany({ where: { workspaceId, status: "ACTIVE", role: { not: "GUEST" }, user: { disabledAt: null } }, select: { role: true, user: { select: { id: true, name: true } } }, orderBy: { joinedAt: "asc" } }),
  prisma.project.findMany({ where: await projectWhere(actor), select: { id: true, name: true, key: true }, orderBy: { name: "asc" }, take: 1000 }),
  prisma.idea.findMany({ where: { workspaceId }, select: { id: true, title: true }, take: 1000, orderBy: { title: "asc" } }),
  admin ? prisma.financeFund.findMany({ where: { workspaceId, archivedAt: null }, select: { id: true, name: true, currency: true } }) : [],
  admin ? prisma.fundingRecord.findMany({ where: { workspaceId, archivedAt: null, kind: { in: ["OPPORTUNITY", "GRANT"] } }, select: { id: true, title: true, currency: true } }) : [],
  admin ? prisma.budget.findMany({ where: { workspaceId }, select: { id: true, name: true, currency: true } }) : [],
  prisma.serviceCatalogItem.findMany({ where: { workspaceId, AND: [teamScopeFilter(await hiddenTeamIds(workspaceId, { userId: actor.user.id, role: actor.membership.role })), ...(section === "ownership" && filters.q ? [{ name: { contains: filters.q.slice(0, 200), mode: "insensitive" as const } }] : []), ...(section === "ownership" && filters.owner ? [{ OR: [{ ownerId: filters.owner.slice(0, 64) }, { backupOwnerId: filters.owner.slice(0, 64) }] }] : [])] }, select: { id: true, name: true, slug: true, kind: true, environment: true, ownerId: true, backupOwnerId: true, teamId: true }, orderBy: { name: "asc" }, take: 1000 }),
  prisma.incident.findMany({ where: { workspaceId }, select: { id: true, title: true, number: true }, orderBy: { startedAt: "desc" }, take: 500 }),
  prisma.task.findMany({ where: { workspaceId, archivedAt: null, project: await projectWhere(actor) }, select: { id: true, title: true, number: true, projectId: true, column: { select: { category: true } } }, orderBy: { updatedAt: "desc" }, take: 1000 }),
 ]);
 const repos = await prisma.githubRepo.findMany({ where: { workspaceId, OR: [{ linkedProjectId: { in: projects.map(p => p.id) } }, { linkedProjectId: null, ...(admin ? {} : { private: false }) }] }, select: { id: true, fullName: true, linkedProjectId: true }, orderBy: { fullName: "asc" }, take: 1000 });
 const githubEvents = await prisma.githubEvent.findMany({ where: { workspaceId, repoId: { in: repos.map(r => r.id) } }, select: { id: true, title: true, repoId: true }, orderBy: { receivedAt: "desc" }, take: 500 });
 const approval = selected?.approvalId ? await prisma.approvalRequest.findFirst({ where: { workspaceId, id: selected.approvalId }, select: { id: true, status: true, requesterId: true } }) : null;
 const parentApproval = selected?.releaseId ? await prisma.productRecord.findFirst({ where: { workspaceId, id: selected.releaseId }, select: { shippedAt: true, approvalId: true } }) : null;
 const parentStatus = parentApproval?.approvalId ? await prisma.approvalRequest.findFirst({ where: { workspaceId, id: parentApproval.approvalId }, select: { status: true } }) : null;
 let frozenScope = false;
 if (selected?.kind === "ROADMAP") {
  const scopeReleases = await prisma.productRecord.findMany({ where: { workspaceId, kind: "RELEASE", archivedAt: null, details: { path: ["roadmapIds"], array_contains: [selected.id] } }, select: { shippedAt: true, approvalId: true } });
  frozenScope = scopeReleases.some(r => !!r.shippedAt) || !!await prisma.approvalRequest.findFirst({ where: { workspaceId, id: { in: scopeReleases.flatMap(r => r.approvalId ? [r.approvalId] : []) }, status: { in: ["PENDING", "APPROVED"] } }, select: { id: true } });
 }
 const selectedLocked = !!(frozenScope ||selected?.archivedAt || selected?.shippedAt || (approval && ["PENDING", "APPROVED"].includes(approval.status)) || (["QA_RUN", "ROADMAP"].includes(selected?.kind ?? "") && (parentApproval?.shippedAt || (parentStatus && ["PENDING", "APPROVED"].includes(parentStatus.status)))));
 return { repos, githubEvents, records, total, page, selected, selectedLocked, approval, choices, people, projects, ideas, funds, funding, budgets, services, incidents, tasks, admin, uploadMaxBytes: maxUploadBytes(), actorId: actor.user.id };
}
export type ProductData = Awaited<ReturnType<typeof loadProductOps>>;
