/** Internal office dates; repeatable without sending invitations or notifications. */
export default async function seedTeamCalendar(
  prisma,
  { workspaceId, workspace, users, channels },
) {
  void users;
  void channels;
  if (process.env.NODE_ENV === "production")
    throw new Error("Demo seeds are for local development only.");
  const members = await prisma.membership.findMany({
    where: { workspaceId, status: "ACTIVE", role: { not: "GUEST" } },
    orderBy: { joinedAt: "asc" },
    select: { userId: true, role: true },
  });
  if (!members.length) return;
  const ownerId =
    members.find((m) => m.role === "OWNER")?.userId ?? members[0].userId;
  const key = (name) => `${workspaceId}-team-calendar-${name}`;
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 2);
  start.setUTCHours(4, 30, 0, 0);
  await prisma.meeting.upsert({
    where: { id: key("office") },
    update: {},
    create: {
      id: key("office"),
      workspaceId,
      title: "Community office weekly planning",
      startsAt: start,
      endsAt: new Date(start.getTime() + 3600000),
      timezone: workspace.timezone,
      location: "Kochi office meeting room",
      visibility: "WORKSPACE",
      facilitatorId: ownerId,
      createdById: ownerId,
      attendees: {
        create: members
          .slice(0, 4)
          .map((m) => ({
            userId: m.userId,
            rsvp: m.userId === ownerId ? "YES" : "PENDING",
          })),
      },
      agenda: {
        create: [
          {
            title: "Volunteer coverage and task assignments",
            sortOrder: 0,
            durationMin: 20,
          },
          {
            title: "Grant report and office filing dates",
            sortOrder: 1,
            durationMin: 20,
          },
          { title: "Owners and next actions", sortOrder: 2, durationMin: 20 },
        ],
      },
    },
  });
  for (const [name, title, kind, visibility, days, notes] of [
    [
      "filing",
      "Review TDS filing with the accountant",
      "DEADLINE",
      "WORKSPACE",
      7,
      "Check the relevant filing period and attach the acknowledgement when ready. Dates are manually maintained.",
    ],
    [
      "grant",
      "Grant utilisation report review",
      "DEADLINE",
      "WORKSPACE",
      10,
      "Bring the signed agreement and expense summary to the internal review.",
    ],
    [
      "reminder",
      "Prepare next week's volunteer handover",
      "REMINDER",
      "PRIVATE",
      3,
      "Confirm owners for office opening and follow-up calls.",
    ],
  ]) {
    const date = new Date(start.getTime() + days * 86400000);
    await prisma.calendarEntry.upsert({
      where: { id: key(name) },
      update: {},
      create: {
        id: key(name),
        workspaceId,
        ownerId,
        title,
        kind,
        visibility,
        startsAt: date,
        endsAt: new Date(date.getTime() + 1800000),
        timezone: workspace.timezone,
        notes,
        reminderMinutes: 1440,
      },
    });
  }
}
