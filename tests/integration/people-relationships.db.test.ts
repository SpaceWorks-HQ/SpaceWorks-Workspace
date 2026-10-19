import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WorkspaceRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";
import type { PeopleActor } from "@/lib/people/context";
import { listMembers, memberProfile, revealEmergencyContact, saveEmergencyContact, saveOwnProfile } from "@/lib/people/profiles";
import { getTeam, joinTeam, listTeams, saveTeam, teamWork } from "@/lib/teams/teams";
import { acceptSwap, dropShift, requestSwap, signUp } from "@/lib/rota/rota";
import { checklistRuns, completeChecklist, saveChecklistTemplate, startChecklist, startOffboarding, tickChecklistItem } from "@/lib/people/onboarding";
import { exportOrganisations, importOrganisations, exportRelationships, getContact, getOrganisation, importContacts, linkRecord, listContacts, listDeals, listOrganisations, saveContact, saveDeal, saveOrganisation } from "@/lib/contacts/contacts";
import { decideTimeOff, requestTimeOff, timeOffRequests } from "@/lib/people/timeOff";
import { visibleAvailability } from "@/lib/people/away";
import { createInvitationToken, invitationExpiry } from "@/lib/invitationTokens";
import { acceptInvitation } from "@/lib/invitations";
import { run as remind } from "@/lib/scheduled/people";

const suffix = uniqueSuffix(); const domain = `@people-${suffix}.test`; const slugs = [`people-${suffix}`, `people-${suffix}-b`];
let owner: PeopleActor; let admin: PeopleActor; let member: PeopleActor; let peer: PeopleActor; let guest: PeopleActor; let other: PeopleActor;
async function makeActor(key: string, role: WorkspaceRole, workspace: PeopleActor["workspace"]): Promise<PeopleActor> {
  const user = await createUser(`${key}${domain}`, key);
  await addMember(workspace.id, user.id, role);
  return { user, workspace, membership: { role } };
}
async function shift(capacity = 1, offset = 0) {
  const type = await prisma.shiftType.upsert({ where: { workspaceId_name: { workspaceId: owner.workspace.id, name: "Build night" } }, create: { workspaceId: owner.workspace.id, name: "Build night" }, update: {} });
  const start = new Date(Date.now() + 7 * 86400000 + offset);
  return prisma.shift.create({ data: { workspaceId: owner.workspace.id, shiftTypeId: type.id, startsAt: start, endsAt: new Date(start.getTime() + 2 * 3600000), capacity } });
}

describe.sequential("people and relationships boundaries", () => {
  beforeAll(async () => {
    const user = await createUser(`owner${domain}`, "Owner");
    const workspace = await createWorkspace(slugs[0], user.id);
    owner = { user, workspace, membership: { role: "OWNER" } };
    admin = await makeActor("admin", "ADMIN", workspace);
    member = await makeActor("member", "MEMBER", workspace);
    peer = await makeActor("peer", "MEMBER", workspace);
    guest = await makeActor("guest", "GUEST", workspace);
    const userB = await createUser(`other${domain}`, "Other owner");
    other = { user: userB, workspace: await createWorkspace(slugs[1], userB.id), membership: { role: "OWNER" } };
  });
  afterAll(async () => { await cleanup(slugs, domain); await prisma.$disconnect(); });

  it("encrypts emergency contacts and audits every authorised view without secret metadata", async () => {
    expect((await saveEmergencyContact(member, { name: "Emergency Person", relation: "Friend", phone: "+911234567890" })).ok).toBe(true);
    const profile = await prisma.memberProfile.findFirstOrThrow({ where: { workspaceId: member.workspace.id, userId: member.user.id } });
    expect(profile.emergencyContactEnc).not.toContain("Emergency Person");
    const before = await prisma.auditEvent.count({ where: { workspaceId: owner.workspace.id, action: "people.emergency_viewed" } });
    for (const actor of [member, admin, owner]) expect(await revealEmergencyContact(actor, member.user.id)).toMatchObject({ ok: true, data: { name: "Emergency Person" } });
    expect((await revealEmergencyContact(peer, member.user.id)).ok).toBe(false);
    expect((await revealEmergencyContact(guest, member.user.id)).ok).toBe(false);
    expect((await revealEmergencyContact(other, member.user.id)).ok).toBe(false);
    const views = await prisma.auditEvent.findMany({ where: { workspaceId: owner.workspace.id, action: "people.emergency_viewed" } });
    expect(views.length - before).toBe(3);
    expect(JSON.stringify(views)).not.toContain("Emergency Person");
    expect(JSON.stringify(await memberProfile(peer, member.user.id))).not.toContain("Emergency Person");
  });
  it("keeps workspace profile edits separate from global and other workspace profiles", async () => {
    await addMember(other.workspace.id, member.user.id);
    expect((await saveOwnProfile(member, { bio: "Local maker", pronouns: "they/them", timezone: "Asia/Kolkata", skills: [{ skill: "Soldering", level: 3 }] })).ok).toBe(true);
    expect((await listMembers(owner, { skill: "soldering" })).map(m => m.id)).toContain(member.user.id);
    const inOther = (await listMembers(other)).find(m => m.id === member.user.id)!;
    expect(inOther.bio).not.toBe("Local maker");
    expect(inOther.skills).toHaveLength(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: member.user.id } })).bio).not.toBe("Local maker");
    expect((await listMembers(guest)).every(m => m.email === null)).toBe(true);
  });
  it("hides private teams, channels and projects from outsiders", async () => {
    const result = await saveTeam(owner, { name: "Private crew", visibility: "PRIVATE" }, null);
    if (!result.ok) throw new Error(result.error);
    const team = result.data!;
    expect((await listTeams(peer)).some(t => t.id === team.id)).toBe(false);
    expect(await getTeam(peer, team.slug)).toBeNull();
    expect((await listMembers(peer, { team: team.id }))).toEqual([]);
    expect(await teamWork(peer, team.id)).toEqual({ channels: [], projects: [] });
    expect((await joinTeam(peer, { teamId: team.id })).ok).toBe(false);
    expect((await getTeam(owner, team.slug))?.id).toBe(team.id);
    expect(await getTeam(other, team.slug)).toBeNull();
  });
  it("allows public team self-join, prevents guest joins and forbids member creation", async () => {
    expect((await saveTeam(member, { name: "Denied" }, null)).ok).toBe(false);
    const result = await saveTeam(owner, { name: "Public crew", visibility: "PUBLIC" }, null);
    if (!result.ok) throw new Error(result.error);
    expect((await joinTeam(member, { teamId: result.data!.id })).ok).toBe(true);
    expect((await joinTeam(guest, { teamId: result.data!.id })).ok).toBe(false);
    expect((await joinTeam(other, { teamId: result.data!.id })).ok).toBe(false);
    const channel = await prisma.channel.create({ data: { workspaceId: owner.workspace.id, teamId: result.data!.id, name: "Crew channel", slug: "crew-channel", kind: "PUBLIC" } });
    expect((await teamWork(guest, result.data!.id)).channels).toHaveLength(0);
    await prisma.channelMember.create({ data: { channelId: channel.id, userId: guest.user.id } });
    expect((await teamWork(guest, result.data!.id)).channels.map(c => c.id)).toContain(channel.id);
    expect(await saveTeam(owner, { name: "Public crew renamed", visibility: "PUBLIC" }, result.data!.id)).toMatchObject({ ok: true, data: { slug: result.data!.slug } });
    expect((await getTeam(member, result.data!.slug))?.name).toBe("Public crew renamed");
  });
  it("serialises sign-ups to the last seat", async () => {
    const row = await shift(1);
    const results = await Promise.all([signUp(member, row.id), signUp(peer, row.id)]);
    expect(results.filter(r => r.ok)).toHaveLength(1);
    expect(await prisma.shiftAssignment.count({ where: { shiftId: row.id, status: "CONFIRMED" } })).toBe(1);
  });
  it("prevents concurrent overlapping sign-ups for one person", async () => {
    const a = await shift(2, 86400000); const b = await shift(2, 86400000 + 1000);
    const results = await Promise.all([signUp(member, a.id), signUp(member, b.id)]);
    expect(results.filter(r => r.ok)).toHaveLength(1);
    expect((await signUp(other, a.id)).ok).toBe(false);
    expect((await signUp(guest, a.id)).ok).toBe(false);
  });
  it("transfers a swap once and allows dropping an upcoming shift", async () => {
    const row = await shift(1, 3 * 86400000);
    expect((await signUp(member, row.id)).ok).toBe(true);
    expect((await requestSwap(member, { shiftId: row.id, toUserId: peer.user.id })).ok).toBe(true);
    const swap = await prisma.shiftSwapRequest.findFirstOrThrow({ where: { assignment: { shiftId: row.id } } });
    expect((await acceptSwap(other, swap.id)).ok).toBe(false);
    expect((await acceptSwap(peer, swap.id)).ok).toBe(true);
    expect((await acceptSwap(peer, swap.id)).ok).toBe(false);
    expect((await dropShift(peer, row.id)).ok).toBe(true);
  });
  it("requires current certifications and keyholder status", async () => {
    const cert = await prisma.certType.create({ data: { workspaceId: owner.workspace.id, name: "Laser safety" } });
    const type = await prisma.shiftType.create({ data: { workspaceId: owner.workspace.id, name: "Laser cover", requiresCertTypeId: cert.id, requiresKeyholder: true } });
    const startsAt = new Date(Date.now() + 15 * 86400000); const endsAt = new Date(startsAt.getTime() + 3600000);
    const row = await prisma.shift.create({ data: { workspaceId: owner.workspace.id, shiftTypeId: type.id, startsAt, endsAt, capacity: 1 } });
    expect((await signUp(member, row.id)).ok).toBe(false);
    await prisma.memberProfile.update({ where: { workspaceId_userId: { workspaceId: owner.workspace.id, userId: member.user.id } }, data: { isKeyholder: true } });
    await prisma.certification.create({ data: { certTypeId: cert.id, userId: member.user.id, expiresAt: new Date(endsAt.getTime() - 1000) } });
    expect((await signUp(member, row.id)).ok).toBe(false);
    await prisma.certification.updateMany({ where: { certTypeId: cert.id, userId: member.user.id }, data: { expiresAt: new Date(endsAt.getTime() + 1000) } });
    expect((await signUp(member, row.id)).ok).toBe(true);
  });
  it("approves time off once and rejects overlapping approvals", async () => {
    const input = { from: "2032-02-01", to: "2032-02-03", visibility: "PRIVATE", note: "Private note" };
    expect((await requestTimeOff(member, input)).ok).toBe(true);
    const requests = await timeOffRequests(member); const request = requests.find(r => r.note === "Private note")!;
    expect((await decideTimeOff(peer, { id: request.id, approved: true })).ok).toBe(false);
    expect((await decideTimeOff(other, { id: request.id, approved: true })).ok).toBe(false);
    expect((await decideTimeOff(admin, { id: request.id, approved: true })).ok).toBe(true);
    expect((await decideTimeOff(admin, { id: request.id, approved: true })).ok).toBe(false);
    await requestTimeOff(member, input);
    const pending = (await timeOffRequests(member)).find(r => r.status === "OPEN")!;
    expect((await decideTimeOff(admin, { id: pending.id, approved: true })).ok).toBe(false);
    const range = { startsAt: new Date("2032-02-01"), endsAt: new Date("2032-02-05") };
    expect(await visibleAvailability(peer, [member.user.id], range)).toHaveLength(0);
    expect(await visibleAvailability(admin, [member.user.id], range)).toHaveLength(1);
  });
  it("starts normalised onboarding templates on invite acceptance exactly once", async () => {
    expect((await saveChecklistTemplate(owner, { name: "Welcome", kind: "ONBOARDING", autoStartFor: "MEMBER", items: [{ title: "Meet the crew", dueOffsetDays: 7 }] })).ok).toBe(true);
    const invited = await createUser(`invited${domain}`);
    const { token, tokenHash } = createInvitationToken();
    await prisma.invitation.create({ data: { workspaceId: owner.workspace.id, email: invited.email, role: "MEMBER", tokenHash, expiresAt: invitationExpiry(), invitedById: owner.user.id } });
    expect((await acceptInvitation(token, { kind: "existing", userId: invited.id })).ok).toBe(true);
    const runs = await prisma.checklistRun.findMany({ where: { workspaceId: owner.workspace.id, subjectUserId: invited.id }, include: { items: true } });
    expect(runs).toHaveLength(1); expect(runs[0].items[0]).toMatchObject({ title: "Meet the crew", assigneeId: invited.id });
    expect(await prisma.notificationEventRecord.count({ where: { workspaceId: owner.workspace.id, type: "member.joined", actorId: invited.id } })).toBe(1);
  });
  it("enforces checklist assignees, required progress and tenant isolation", async () => {
    const template = await prisma.checklistTemplate.findFirstOrThrow({ where: { workspaceId: owner.workspace.id, name: "Welcome" } });
    const result = await startChecklist(owner, { templateId: template.id, userId: peer.user.id });
    if (!result.ok) throw new Error(result.error);
    const run = await prisma.checklistRun.findUniqueOrThrow({ where: { id: result.data!.id }, include: { items: true } });
    expect((await completeChecklist(peer, { id: run.id })).ok).toBe(false);
    expect((await tickChecklistItem(member, { id: run.items[0].id, done: true })).ok).toBe(false);
    expect((await tickChecklistItem(other, { id: run.items[0].id, done: true })).ok).toBe(false);
    expect((await tickChecklistItem(peer, { id: run.items[0].id, done: true })).ok).toBe(true);
    expect((await completeChecklist(peer, { id: run.id })).ok).toBe(true);
    expect((await tickChecklistItem(peer, { id: run.items[0].id, done: false })).ok).toBe(false);
  });
  it("generates offboarding from read-only records, hides it from subjects and can suspend safely", async () => {
    const vault = await prisma.vaultItem.create({ data: { workspaceId: owner.workspace.id, ownerId: member.user.id, type: "LOGIN", title: "Shared login", secretEnc: "unread-ciphertext", dataKeyEnc: "unread-key" } });
    const service = await prisma.serviceCatalogItem.create({ data: { workspaceId: owner.workspace.id, ownerId: member.user.id, name: "Community site", slug: "community-site", kind: "WEBSITE" } });
    const asset = await prisma.asset.create({ data: { workspaceId: owner.workspace.id, tag: "PEOPLE-1", name: "Laptop", category: "Computer" } });
    await prisma.assetCheckout.create({ data: { assetId: asset.id, userId: member.user.id } });
    const key = await prisma.accessCredential.create({ data: { workspaceId: owner.workspace.id, type: "KEY", label: "Front door", holderUserId: member.user.id } });
    const result = await startOffboarding(owner, { userId: member.user.id });
    if (!result.ok) throw new Error(result.error);
    const run = await prisma.checklistRun.findUniqueOrThrow({ where: { id: result.data!.id }, include: { items: true } });
    expect(run.items.map(i => i.sourceId)).toEqual(expect.arrayContaining([vault.id, service.id, asset.id, key.id]));
    expect((await checklistRuns(member)).some(r => r.id === run.id)).toBe(false);
    expect((await startOffboarding(admin, { userId: owner.user.id })).ok).toBe(false);
    expect((await startOffboarding(other, { userId: member.user.id })).ok).toBe(false);
    for (const item of run.items) expect((await tickChecklistItem(owner, { id: item.id, done: true })).ok).toBe(true);
    expect((await completeChecklist(owner, { id: run.id, suspend: true })).ok).toBe(true);
    expect((await prisma.membership.findFirstOrThrow({ where: { workspaceId: owner.workspace.id, userId: member.user.id } })).status).toBe("SUSPENDED");
    expect((await prisma.vaultItem.findUniqueOrThrow({ where: { id: vault.id } })).secretEnc).toBe("unread-ciphertext");
    expect((await prisma.serviceCatalogItem.findUniqueOrThrow({ where: { id: service.id } })).ownerId).toBe(member.user.id);
    expect((await revealEmergencyContact(member, member.user.id)).ok).toBe(false);
  });
  it("authorises contact writes, hides private records and redacts sensitive phones", async () => {
    const result = await saveContact(peer, { displayName: "Community mentor", tags: ["Hardware"], email: "mentor@example.test", phone: "+911234567890", sensitivePhone: true });
    if (!result.ok) throw new Error(result.error);
    const id = result.data!.id;
    expect((await listContacts(peer, "hardware")).map(c => c.id)).toContain(id);
    expect(await getContact(guest, id)).toBeNull();
    expect(await getContact(other, id)).toBeNull();
    expect((await getContact(owner, id))?.phones).toEqual(expect.arrayContaining([expect.objectContaining({ sensitive: true })]));
    const reader: PeopleActor = { ...admin, membership: { role: "MEMBER" } };
    expect((await getContact(reader, id))?.phones).toEqual([]);
    expect((await saveContact(reader, { displayName: "Denied" }, id)).ok).toBe(false);
    expect((await saveContact(other, { displayName: "Denied" }, id)).ok).toBe(false);
    expect((await saveContact(guest, { displayName: "Denied" })).ok).toBe(false);
    const privateResult = await saveContact(peer, { displayName: "Private mentor", visibility: "PRIVATE" });
    if (!privateResult.ok) throw new Error(privateResult.error);
    expect(await getContact(reader, privateResult.data!.id)).toBeNull();
    expect((await listContacts(other))).toEqual([]);
  });
  it("checks linked IDs, organisation ownership, pipeline amounts and domains", async () => {
    const org = await saveOrganisation(peer, { name: "Maker partner", website: "https://www.partner.test" });
    if (!org.ok) throw new Error(org.error);
    expect((await getOrganisation(other, org.data!.id))).toBeNull();
    const duplicate = await saveOrganisation(owner, { name: "Partner alternate", website: "http://partner.test" });
    expect(duplicate).toMatchObject({ ok: true, data: { duplicates: [org.data!.id] } });
    expect((await saveDeal(other, { organisationId: org.data!.id, title: "Denied", type: "SPONSORSHIP", stage: "Prospect" })).ok).toBe(false);
    expect((await saveDeal(peer, { organisationId: org.data!.id, title: "Build night sponsor", type: "SPONSORSHIP", stage: "Proposal", amountMinor: 125050, currency: "INR" })).ok).toBe(true);
    expect((await listDeals(other))).toEqual([]);
    expect((await listDeals(peer))[0].amountMinor).toBe(125050);
    const foreign = await saveContact(other, { displayName: "Foreign" });
    if (!foreign.ok) throw new Error(foreign.error);
    expect((await linkRecord(peer, { fromType: "organisation", fromId: org.data!.id, toType: "contact", toId: foreign.data!.id })).ok).toBe(false);
    expect((await listOrganisations(guest))).toEqual([]);
  });
  it("restricts CSV transfer to admins and skips duplicates within an import", async () => {
    expect((await importContacts(peer, "name,email\nAda,ada@example.test")).ok).toBe(false);
    expect((await exportRelationships(peer, "csv")).ok).toBe(false);
    expect(await importContacts(owner, "name,email\nAda,ada@example.test\nAda Duplicate,ADA@example.test")).toMatchObject({ ok: true, data: { created: 1, skipped: 1 } });
    expect((await importOrganisations(peer, "name,website\nPartner,https://example.test")).ok).toBe(false);
    expect(await importOrganisations(owner, "name,website\nPartner,https://example.test\nOther partner,http://www.example.test")).toMatchObject({ ok: true, data: { created: 1, skipped: 1 } });
    expect(await exportOrganisations(owner)).toMatchObject({ ok: true, data: { content: expect.stringContaining("https://example.test") } });
    const exported = await exportRelationships(owner, "vcard");
    expect(exported.ok && exported.data?.content).toContain("BEGIN:VCARD");
    expect((await exportRelationships(other, "csv"))).toMatchObject({ ok: true, data: { content: expect.not.stringContaining("ada@example.test") } });
  });
  it("deduplicates scheduled reminders across replica ticks", async () => {
    const type = await prisma.shiftType.create({ data: { workspaceId: owner.workspace.id, name: "Reminder shift" } });
    const now = new Date(); const row = await prisma.shift.create({ data: { workspaceId: owner.workspace.id, shiftTypeId: type.id, startsAt: new Date(now.getTime() + 3600000), endsAt: new Date(now.getTime() + 7200000), capacity: 2, assignments: { create: { userId: peer.user.id } } } });
    await Promise.all([remind(now), remind(now)]);
    expect(await prisma.notificationEventRecord.count({ where: { workspaceId: owner.workspace.id, type: "shift.reminder", payload: { path: ["resource", "id"], equals: row.id } } })).toBe(1);
    expect(await prisma.notificationEventRecord.count({ where: { workspaceId: owner.workspace.id, type: "shift.unfilled", payload: { path: ["resource", "id"], equals: row.id } } })).toBe(1);
    await prisma.shiftAssignment.create({ data: { shiftId: row.id, userId: owner.user.id } });
    await remind(now);
    expect(await prisma.notificationEventRecord.count({ where: { workspaceId: owner.workspace.id, type: "shift.reminder", payload: { path: ["resource", "id"], equals: row.id } } })).toBe(2);
  });
});
