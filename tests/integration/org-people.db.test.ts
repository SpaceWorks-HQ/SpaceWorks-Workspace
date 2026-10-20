import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { deleteObjects, getObject } from "@/lib/storage";
import { createUser, createWorkspace, addMember, cleanup, uniqueSuffix } from "../helpers/fixtures";
import { orgData, saveDepartment, saveReporting, saveResponsibility, responsibilities, saveEscalation, escalationData, saveAttendance, attendanceData, profileOrganisation, type OrgActor } from "@/lib/orgPeople/service";
import { saveOwnProfile, memberProfile } from "@/lib/people/profiles";
import { requestTimeOff, decideTimeOff } from "@/lib/people/timeOff";
import { cancelLeave } from "@/lib/opsGaps/leave";
import { orgExport } from "@/lib/orgPeople/export";
import { run } from "@/lib/scheduled/orgPeople";
import { findDownloadableFile } from "@/lib/files";
import { libraryWhere } from "@/lib/files/service";
import { canReadOrgRecord, canDownloadOrgFile, attachOrgFiles } from "@/lib/orgPeople/files";
import { searchDocuments, canAccessResource } from "@/lib/search/query";
import { dayRange } from "@/lib/people/availability";
const suffix = uniqueSuffix(), domain = `@org-${suffix}.test`, slugs = [`org-${suffix}`, `other-org-${suffix}`];
let owner: OrgActor, admin: OrgActor, manager: OrgActor, staff: OrgActor, peer: OrgActor, guest: OrgActor, other: OrgActor;
let department: string, child: string, responsibility: string, entry: string;
async function make(key: string, role: "MEMBER" | "ADMIN" | "GUEST", workspace: OrgActor["workspace"]) { const user = await createUser(key + domain, key); await addMember(workspace.id, user.id, role); return { user, workspace, membership: { role } }; }
beforeAll(async () => {
  const user = await createUser(`owner${domain}`, "Owner"); const workspace = await createWorkspace(slugs[0], user.id); owner = { user, workspace, membership: { role: "OWNER" } };
  admin = await make("admin", "ADMIN", workspace); manager = await make("manager", "MEMBER", workspace); staff = await make("staff", "MEMBER", workspace); peer = await make("peer", "MEMBER", workspace); guest = await make("guest", "GUEST", workspace);
  const user2 = await createUser(`other${domain}`, "Other"); other = { user: user2, workspace: await createWorkspace(slugs[1], user2.id), membership: { role: "OWNER" } };
});
afterAll(async () => { await cleanup(slugs, domain); await prisma.$disconnect(); });
describe("organisation and responsibilities", () => {
  it("isolates departments and prevents ancestry cycles under concurrent edits", async () => {
    department = await saveDepartment(owner, { name: "Community office", headId: manager.user.id });
    child = await saveDepartment(owner, { name: "Outreach", parentId: department });
    await expect(saveDepartment(manager, { name: "Denied" })).rejects.toThrow();
    await expect(saveDepartment(other, { id: department, name: "Foreign" })).rejects.toThrow();
    await expect(saveDepartment(owner, { id: department, name: "Community office", parentId: child })).rejects.toThrow();
    await expect(saveDepartment(owner, { name: "community OFFICE" })).rejects.toThrow();
    await expect(saveDepartment(owner, { name: "Bad head", headId: other.user.id })).rejects.toThrow();
    const a = await saveDepartment(owner, { name: "A" }), b = await saveDepartment(owner, { name: "B" });
    const results = await Promise.allSettled([saveDepartment(owner, { id: a, name: "A", parentId: b }), saveDepartment(owner, { id: b, name: "B", parentId: a })]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((await orgData(other)).departments).toEqual([]);
  });
  it("validates reporting chains, tenant membership and the admin hierarchy", async () => {
    await saveReporting(owner, { userId: staff.user.id, managerId: manager.user.id, departmentId: child });
    await expect(saveReporting(owner, { userId: manager.user.id, managerId: staff.user.id })).rejects.toThrow();
    await expect(saveReporting(owner, { userId: staff.user.id, managerId: other.user.id })).rejects.toThrow();
    await expect(saveReporting(owner, { userId: staff.user.id, departmentId: "foreign" })).rejects.toThrow();
    await expect(saveReporting(admin, { userId: owner.user.id, managerId: manager.user.id })).rejects.toThrow();
    const data = await orgData(manager); expect(data.people.find(p => p.id === staff.user.id)).toMatchObject({ managerId: manager.user.id, departmentId: child });
  });
  it("registers all RACI roles and profile responsibilities without exposing to guests", async () => {
    responsibility = await saveResponsibility(owner, { title: "Bank reconciliation", responsibleIds: [staff.user.id], accountableId: manager.user.id, consultedIds: [admin.user.id], informedIds: [peer.user.id], backupId: peer.user.id, reviewOn: "2026-10-21" });
    await expect(saveResponsibility(staff, { title: "Denied" })).rejects.toThrow();
    await expect(saveResponsibility(owner, { title: "Bad", responsibleIds: [other.user.id], accountableId: manager.user.id, reviewOn: "2026-10-21" })).rejects.toThrow();
    await expect(saveResponsibility(other, { id: responsibility, title: "Bad", responsibleIds: [other.user.id], accountableId: other.user.id, reviewOn: "2026-10-21" })).rejects.toThrow();
    expect((await responsibilities(staff, { userId: staff.user.id })).map(r => r.id)).toEqual([responsibility]);
    expect((await profileOrganisation(staff, staff.user.id))?.responsibilities[0].roles).toEqual(["Responsible"]);
    expect(await profileOrganisation(guest, staff.user.id)).toBeNull();
    expect(JSON.stringify((await memberProfile(guest, owner.user.id))?.activity)).not.toContain("Bank reconciliation");
    await expect(responsibilities(guest)).rejects.toThrow();
    expect(await responsibilities(other)).toEqual([]);
  });
  it("redacts personal contact details until the owner explicitly shares them", async () => {
    await saveOwnProfile(staff, { contactPhone: "+91 90000 12345", contactHandle: "Signal: office", contactVisibility: "PRIVATE" });
    await saveEscalation(owner, { title: "Fire safety", hoursNote: "Mon–Fri 9–5 Asia/Kolkata", steps: [{ userId: staff.user.id, hours: "IN_HOURS" }, { userId: manager.user.id, hours: "OUT_OF_HOURS" }] });
    expect((await escalationData(peer)).contacts.find(c => c.userId === staff.user.id)).toBeUndefined();
    expect((await escalationData(owner)).contacts.find(c => c.userId === staff.user.id)?.contactPhone).toBe("+91 90000 12345");
    expect((await memberProfile(peer, staff.user.id))?.contactPhone).toBeNull();
    expect(await (await orgExport(peer, "escalation", { month: "2026-10" })).text()).not.toContain("90000 12345");
    expect(await (await orgExport(owner, "organisation", { month: "2026-10" })).text()).toContain("Outreach");
    await saveOwnProfile(staff, { contactPhone: "+91 90000 12345", contactVisibility: "WORKSPACE" });
    expect((await escalationData(peer)).contacts.find(c => c.userId === staff.user.id)?.contactPhone).toBe("+91 90000 12345");
    expect((await memberProfile(guest, staff.user.id))?.contactPhone).toBeNull();
    await saveOwnProfile(staff, { bio: "Updated bio" });
    expect((await memberProfile(peer, staff.user.id))?.contactPhone).toBe("+91 90000 12345");
    expect((await escalationData(other)).paths).toEqual([]);
    await expect(saveEscalation(owner, { title: "Invalid", steps: [{ userId: other.user.id, hours: "ANY_TIME" }] })).rejects.toThrow();
  });
});
describe("attendance", () => {
  it("permits personal and direct-manager entry but rejects peers and other tenants", async () => {
    entry = await saveAttendance(staff, { userId: staff.user.id, dateOn: "2026-10-01", status: "PRESENT", notes: "Private office note" });
    const original = await prisma.attendanceEntry.findUniqueOrThrow({ where: { id: entry } });
    await saveAttendance(manager, { userId: staff.user.id, dateOn: "2026-10-01", status: "HALF_DAY", version: original.updatedAt.toISOString() });
    await expect(saveAttendance(peer, { userId: staff.user.id, dateOn: "2026-10-02", status: "PRESENT" })).rejects.toThrow();
    await expect(saveAttendance(other, { userId: staff.user.id, dateOn: "2026-10-02", status: "PRESENT" })).rejects.toThrow();
    await expect(saveAttendance(guest, { userId: guest.user.id, dateOn: "2026-10-02", status: "PRESENT" })).rejects.toThrow();
    await expect(saveAttendance(admin, { userId: owner.user.id, dateOn: "2026-10-02", status: "PRESENT" })).rejects.toThrow();
    await expect(saveAttendance(staff, { userId: staff.user.id, dateOn: "2199-01-01", status: "PRESENT" })).rejects.toThrow();
    await expect(saveAttendance(staff, { userId: staff.user.id, dateOn: "2026-10-01", status: "REMOTE", version: original.updatedAt.toISOString() })).rejects.toThrow(/changed/);
  });
  it("serialises duplicate initial entries without losing an update", async () => {
    const results = await Promise.allSettled([saveAttendance(staff, { userId: staff.user.id, dateOn: "2026-10-02", status: "PRESENT" }), saveAttendance(manager, { userId: staff.user.id, dateOn: "2026-10-02", status: "REMOTE" })]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.attendanceEntry.count({ where: { workspaceId: owner.workspace.id, userId: staff.user.id, dateOn: new Date("2026-10-02") } })).toBe(1);
  });
  it("pre-fills only approved away leave and follows cancellation without sharing leave notes", async () => {
    expect((await requestTimeOff(staff, { from: "2026-10-05", to: "2026-10-06", note: "Medical confidential", visibility: "PRIVATE" })).ok).toBe(true);
    const run = await prisma.checklistRun.findFirstOrThrow({ where: { workspaceId: owner.workspace.id, subjectUserId: staff.user.id, status: "OPEN" } });
    expect((await attendanceData(manager, "2026-10")).cells.find(c => c.userId === staff.user.id && c.date === "2026-10-05")?.status).toBeUndefined();
    expect((await decideTimeOff(admin, { id: run.id, approved: true })).ok).toBe(true);
    const data = await attendanceData(manager, "2026-10"); expect(data.cells.find(c => c.userId === staff.user.id && c.date === "2026-10-05")).toMatchObject({ status: "ON_LEAVE", source: "Approved leave" }); expect(JSON.stringify(data)).not.toContain("Medical confidential");
    await expect(saveAttendance(staff, { userId: staff.user.id, dateOn: "2026-10-05", status: "PRESENT" })).rejects.toThrow(/approved leave/);
    await cancelLeave(staff, { id: run.id });
    expect((await attendanceData(manager, "2026-10")).cells.find(c => c.userId === staff.user.id && c.date === "2026-10-05")?.status).toBeUndefined();
    await prisma.availability.create({ data: { workspaceId: owner.workspace.id, userId: staff.user.id, ...dayRange("2026-10-08", "2026-10-08", "Asia/Kolkata"), type: "AWAY" } });
    expect((await attendanceData(manager, "2026-10")).cells.find(c => c.userId === staff.user.id && c.date === "2026-10-08")?.status).toBeUndefined();
  });
  it("scopes month/team filters and CSV exports to the current viewer", async () => {
    const team = await prisma.team.create({ data: { workspaceId: owner.workspace.id, name: "Office", slug: "office", members: { create: [{ userId: staff.user.id }, { userId: peer.user.id }] } } });
    const data = await attendanceData(manager, "2026-10", { teamId: team.id }); expect(data.people.map(p => p.userId)).toEqual([staff.user.id]);
    await expect(attendanceData(peer, "2026-10", { userId: staff.user.id })).rejects.toThrow();
    await expect(attendanceData(manager, "2026-10", { teamId: "foreign" })).rejects.toThrow();
    const response = await orgExport(manager, "attendance", { month: "2026-10", teamId: team.id }); const csv = await response.text(); expect(csv).toContain('"Half-day","0.5"'); expect(csv).not.toContain(peer.user.id); expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("revokes manager access immediately when the reporting line changes", async () => {
    expect(await canReadOrgRecord(manager, "attendance", entry)).toBe(true);
    await saveReporting(owner, { userId: staff.user.id, managerId: peer.user.id });
    expect(await canReadOrgRecord(manager, "attendance", entry)).toBe(false);
    await saveReporting(owner, { userId: staff.user.id, managerId: manager.user.id, departmentId: child });
  });
});
describe("files, reminders and discovery", () => {
  it("protects linked files and reserved-folder orphans from the library and unauthorised download", async () => {
    const file = await prisma.fileObject.create({ data: { workspaceId: owner.workspace.id, storageKey: `org-${suffix}/proof`, filename: "proof.pdf", contentType: "application/pdf", size: 5, folder: "/org-people" } });
    expect(await findDownloadableFile(file.id, staff.user.id)).toBeNull();
    await prisma.orgPeopleAttachment.create({ data: { workspaceId: owner.workspace.id, kind: "attendance", recordId: entry, fileId: file.id } });
    expect((await findDownloadableFile(file.id, staff.user.id))?.id).toBe(file.id);
    expect((await findDownloadableFile(file.id, manager.user.id))?.id).toBe(file.id);
    expect(await findDownloadableFile(file.id, peer.user.id)).toBeNull(); expect(await findDownloadableFile(file.id, other.user.id)).toBeNull();
    expect(await prisma.fileObject.findMany({ where: await libraryWhere(owner) })).toEqual([]);
    expect(await canDownloadOrgFile(file, guest.user.id, "GUEST")).toBe(false);
    await expect(attachOrgFiles(peer, "attendance", entry, [new File(["x"], "bad.pdf", { type: "application/pdf" })])).rejects.toThrow();
    await expect(attachOrgFiles(staff, "attendance", entry, [new File(["x"], "bad.exe", { type: "application/octet-stream" })])).rejects.toThrow();
  });
  it.skipIf(!process.env.TEST_S3_BUCKET)("stores multiple proofs in private object storage and applies current permissions", async () => {
    const { PDFDocument } = await import("pdf-lib"); const pdf = await PDFDocument.create(); pdf.addPage(); const bytes = await pdf.save();
    const input = [new File([new Uint8Array(bytes)], "attendance-proof.pdf", { type: "application/pdf" }), new File([new Uint8Array(bytes)], "office-proof.pdf", { type: "application/pdf" })];
    await attachOrgFiles(staff, "attendance", entry, input);
    const files = await prisma.orgPeopleAttachment.findMany({ where: { workspaceId: owner.workspace.id, kind: "attendance", recordId: entry, file: { filename: { in: ["attendance-proof.pdf", "office-proof.pdf"] } } }, include: { file: true } });
    try { expect(files).toHaveLength(2); for (const { file } of files) { expect((await getObject(file.storageKey))?.body).toBeTruthy(); expect((await findDownloadableFile(file.id, manager.user.id))?.id).toBe(file.id); expect(await findDownloadableFile(file.id, peer.user.id)).toBeNull(); } }
    finally { await deleteObjects(files.map(f => f.file.storageKey)); }
  });
  it("indexes safe register titles and checks live access after archiving", async () => {
    expect((await searchDocuments({ workspaceId: owner.workspace.id, userId: staff.user.id, role: "MEMBER" }, "Bank reconciliation", "org_responsibility")).map(r => r.entityId)).toContain(responsibility);
    expect(await canAccessResource({ workspaceId: owner.workspace.id, userId: guest.user.id, role: "GUEST" }, "org_responsibility", responsibility)).toBe(false);
    expect(await canAccessResource({ workspaceId: other.workspace.id, userId: other.user.id, role: "OWNER" }, "org_responsibility", responsibility)).toBe(false);
    expect(await canAccessResource({ workspaceId: owner.workspace.id, userId: peer.user.id, role: "MEMBER" }, "org_attendance", entry)).toBe(false);
    const doc = await prisma.searchDocument.findFirstOrThrow({ where: { entityType: "org_attendance", entityId: entry } }); expect(doc).toMatchObject({ visibility: "PRIVATE", ownerId: staff.user.id, body: "" });
  });
  it("deduplicates review reminders across replicas and retries", async () => {
    const now = new Date("2026-10-20T12:00:00Z"); await Promise.all([run(now), run(now)]); await run(now);
    expect(await prisma.notificationEventRecord.count({ where: { workspaceId: owner.workspace.id, type: "people.responsibility_review_due" } })).toBe(1);
    const r = await prisma.responsibility.findUniqueOrThrow({ where: { id: responsibility } });
    await saveResponsibility(owner, { ...r, reviewOn: "2026-10-25", status: "PAUSED" }); await run(now);
    expect(await prisma.notificationEventRecord.count({ where: { workspaceId: owner.workspace.id, type: "people.responsibility_review_due" } })).toBe(1);
    await saveResponsibility(owner, { ...r, reviewOn: "2026-10-25" }); await run(now);
    expect(await prisma.notificationEventRecord.count({ where: { workspaceId: owner.workspace.id, type: "people.responsibility_review_due" } })).toBe(2);
    await saveResponsibility(owner, { ...r, reviewOn: "2026-10-25", status: "ARCHIVED" });
    expect((await searchDocuments({ workspaceId: owner.workspace.id, userId: staff.user.id, role: "MEMBER" }, "Bank reconciliation", "org_responsibility"))).toEqual([]);
  });
  it("rejects stale roles, suspended users and archived workspace reads", async () => {
    await prisma.membership.update({ where: { userId_workspaceId: { workspaceId: owner.workspace.id, userId: peer.user.id } }, data: { status: "SUSPENDED" } });
    await expect(orgData(peer)).rejects.toThrow(); await expect(saveAttendance(peer, { userId: peer.user.id, dateOn: "2026-10-01", status: "PRESENT" })).rejects.toThrow();
    await expect(orgData({ ...staff, membership: { role: "OWNER" } })).rejects.toThrow();
    await prisma.workspace.update({ where: { id: other.workspace.id }, data: { archivedAt: new Date() } }); await expect(orgData(other)).rejects.toThrow();
  });
});
