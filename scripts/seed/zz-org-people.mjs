/** Runs after the existing people demo so reporting lines extend those profiles. */
export default async function seedOrgPeople(prisma, { workspaceId, users }) {
  const { owner, admin, meera, joel, fathima } = users;
  if (!owner || !admin || !meera || !joel || !fathima) return;
  const office = await prisma.department.upsert({ where: { workspaceId_name: { workspaceId, name: "Community office" } }, update: {}, create: { workspaceId, name: "Community office", headId: owner.id, notes: "Internal operating team for a Kochi community organisation." } });
  const outreach = await prisma.department.upsert({ where: { workspaceId_name: { workspaceId, name: "Programmes and outreach" } }, update: {}, create: { workspaceId, name: "Programmes and outreach", parentId: office.id, headId: meera.id } });
  for (const [person, departmentId, managerId, engagementType] of [[admin, office.id, owner.id, "STAFF"], [meera, outreach.id, admin.id, "STAFF"], [joel, outreach.id, meera.id, "VOLUNTEER"], [fathima, outreach.id, meera.id, "INTERN"]]) {
    const data = { departmentId, managerId, engagementType };
    await prisma.memberProfile.upsert({ where: { workspaceId_userId: { workspaceId, userId: person.id } }, update: data, create: { workspaceId, userId: person.id, ...data } });
  }
  const now = new Date(); const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" }).formatToParts(now); const year = month.find(p => p.type === "year").value; const m = month.find(p => p.type === "month").value;
  const reviewOn = new Date(now.getTime() + 5 * 86400000); reviewOn.setUTCHours(0, 0, 0, 0);
  for (const [title, responsibleIds, accountableId, backupId] of [["Bank reconciliation", [admin.id], owner.id, meera.id], ["Website", [joel.id], meera.id, fathima.id], ["Fire safety", [meera.id], admin.id, joel.id]]) {
    if (!await prisma.responsibility.findFirst({ where: { workspaceId, title } })) await prisma.responsibility.create({ data: { workspaceId, title, responsibleIds, accountableId, backupId, consultedIds: [owner.id], informedIds: [fathima.id], reviewOn, createdById: owner.id, notes: "Review the process and confirm backup cover at the monthly team meeting." } });
  }
  for (const [person, status] of [[admin, "PRESENT"], [meera, "REMOTE"], [joel, "HALF_DAY"], [fathima, "PRESENT"]]) await prisma.attendanceEntry.upsert({ where: { workspaceId_userId_dateOn: { workspaceId, userId: person.id, dateOn: new Date(`${year}-${m}-01`) } }, update: {}, create: { workspaceId, userId: person.id, dateOn: new Date(`${year}-${m}-01`), status, recordedById: person.id, notes: "Manual office register." } });
  if (!await prisma.orgEscalationPath.findFirst({ where: { workspaceId, title: "Office safety" } })) await prisma.orgEscalationPath.create({ data: { workspaceId, title: "Office safety", hoursNote: "Monday–Friday, 9 am–5 pm, Asia/Kolkata", notes: "For immediate danger, contact local emergency services first.", steps: [{ userId: meera.id, hours: "IN_HOURS", instruction: "Describe the issue and location." }, { userId: admin.id, hours: "ANY_TIME", instruction: "Try next if the first person is unavailable." }, { userId: owner.id, hours: "OUT_OF_HOURS", instruction: "Escalate urgent office issues." }] } });
}
