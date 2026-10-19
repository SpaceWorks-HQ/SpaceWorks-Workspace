/** Demo people and relationships; the demo runner recreates the workspace. */
export default async function seedPeopleRelationships(prisma, { workspaceId, users }) {
  const people = Object.entries(users);
  for (const [key, user] of people) {
    const skills = (user.skills ?? []).map(skill => skill.toLowerCase());
    await prisma.memberProfile.create({ data: {
      workspaceId, userId: user.id, location: "Kochi", interests: key === "meera" ? ["Open hardware", "Teaching"] : ["Making together"],
      isKeyholder: ["owner", "admin"].includes(key), membershipType: ["owner", "admin"].includes(key) ? "CORE" : "MEMBER",
      handles: { profile: { bio: user.bio ?? "", pronouns: "", timezone: "Asia/Kolkata" } },
      skills: { create: skills.map(skill => ({ workspaceId, skill, level: key === "guest" ? 3 : 2 })) },
    } });
  }
  const team = await prisma.team.create({ data: {
    workspaceId, name: "Build night crew", slug: "build-night-crew", description: "Welcoming makers and keeping the workbenches ready.", color: "teal", visibility: "PUBLIC", createdById: users.owner.id,
    members: { create: [{ userId: users.admin.id, role: "LEAD" }, { userId: users.meera.id }, { userId: users.joel.id }] },
  } });
  await prisma.team.create({ data: { workspaceId, name: "Community stewards", slug: "community-stewards", visibility: "PRIVATE", description: "Quiet planning for the community.", createdById: users.owner.id, members: { create: [{ userId: users.owner.id, role: "LEAD" }, { userId: users.admin.id }] } } });
  const cert = await prisma.certType.create({ data: { workspaceId, name: "Laser cutter safety", description: "Ventilation, materials and supervised operation.", validityDays: 365, trainerIds: [users.admin.id] } });
  await prisma.certification.create({ data: { certTypeId: cert.id, userId: users.meera.id, grantedById: users.admin.id, expiresAt: new Date(Date.now() + 21 * 86400000) } });
  const type = await prisma.shiftType.create({ data: { workspaceId, name: "Build night welcome", teamId: team.id, defaultCapacity: 2 } });
  for (let day = 1; day <= 7; day += 2) {
    const startsAt = new Date(); startsAt.setUTCDate(startsAt.getUTCDate() + day); startsAt.setUTCHours(12, 30, 0, 0);
    await prisma.shift.create({ data: { workspaceId, shiftTypeId: type.id, startsAt, endsAt: new Date(startsAt.getTime() + 7200000), capacity: 2, location: "Space Works welcome desk", createdById: users.admin.id, assignments: { create: { userId: users.joel.id } } } });
  }
  const template = await prisma.checklistTemplate.create({ data: { workspaceId, name: "Welcome to Space Works", kind: "ONBOARDING", autoStartFor: "MEMBER", createdById: users.owner.id, items: [
    { title: "Meet the crew", assigneeRule: "SUBJECT", dueOffsetDays: 3, required: true },
    { title: "Read the workshop safety guide", assigneeRule: "SUBJECT", dueOffsetDays: 7, required: true },
    { title: "Choose your first build night", assigneeRule: "SUBJECT", dueOffsetDays: 14, required: false },
  ] } });
  await prisma.checklistRun.create({ data: { workspaceId, templateId: template.id, kind: "ONBOARDING", title: "Welcome to Space Works: Fathima", subjectUserId: users.fathima.id, createdById: users.admin.id, items: { create: [
    { title: "Meet the crew", assigneeId: users.fathima.id, doneAt: new Date(), doneById: users.fathima.id, sortOrder: 0 },
    { title: "Read the workshop safety guide", assigneeId: users.fathima.id, dueAt: new Date(Date.now() + 3 * 86400000), sortOrder: 1 },
  ] } } });
  const org = await prisma.organisation.create({ data: { workspaceId, name: "Kochi Maker Partners", kinds: ["SPONSOR", "PARTNER"], website: "https://example.org", domain: "example.org", tags: ["workshops"], ownerId: users.admin.id, createdById: users.admin.id, notesMd: "Interested in supporting open hardware workshops." } });
  const contact = await prisma.contact.create({ data: { workspaceId, displayName: "Asha Mathew", emails: [{ type: "work", value: "asha@example.org", primary: true }], kinds: ["mentor"], tags: ["hardware", "workshops"], ownerId: users.admin.id, createdById: users.admin.id, nextFollowUpAt: new Date(Date.now() + 3 * 86400000), orgRoles: { create: { organisationId: org.id, title: "Community partnerships", isPrimary: true } } } });
  await prisma.contactInteraction.create({ data: { workspaceId, contactId: contact.id, organisationId: org.id, type: "MEETING", occurredAt: new Date(), summary: "Discussed the next open hardware workshop", bodyMd: "Share the workshop outline and volunteer plan.", byUserId: users.admin.id } });
  await prisma.deal.create({ data: { workspaceId, organisationId: org.id, title: "Open hardware workshop support", type: "SPONSORSHIP", stage: "Proposal", amountMinor: 2500000, currency: "INR", ownerId: users.admin.id } });
}
