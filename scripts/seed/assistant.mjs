#!/usr/bin/env node
// Demo data for the Space Works Assistant in the "TinkerSpace Kochi" demo
// workspace (run scripts/seed-demo.mjs first): a few workspace memories, a
// paused "Morning digest" job posting to #general and a finished Boardroom
// session. Idempotent: replaces its own rows on every run. The built-in skills
// are added from Assistant → Skills ("Add them"). Local development only.
//
//   node --env-file-if-exists=.env scripts/seed/assistant.mjs
import { PrismaClient } from "@prisma/client";

if (process.env.NODE_ENV === "production") throw new Error("Demo seeds are for local development only.");

const prisma = new PrismaClient();
const SLUG = "tinkerspace-kochi";
const JOB_NAME = "Morning digest";
const SESSION_TITLE = "Second laser cutter?";

const MEMORIES = [
  { content: "Build nights are every Thursday from 6 pm to 9 pm at the space.", tags: ["schedule"] },
  { content: "Spare PLA and PETG filament live in the grey cabinet next to the print farm.", tags: ["space", "3d-printing"] },
  { content: "Only members with a laser sign-off may run the laser cutter alone.", tags: ["safety", "laser"] },
];

async function main() {
  const workspace = await prisma.workspace.findUnique({ where: { slug: SLUG }, select: { id: true, timezone: true } });
  if (!workspace) throw new Error("Run scripts/seed-demo.mjs first.");
  const owner = await prisma.membership.findFirst({ where: { workspaceId: workspace.id, role: "OWNER" }, select: { userId: true } });
  const general = await prisma.channel.findFirst({ where: { workspaceId: workspace.id, slug: "general" }, select: { id: true } });

  await prisma.assistantMemory.deleteMany({ where: { workspaceId: workspace.id, content: { in: MEMORIES.map((m) => m.content) } } });
  await prisma.assistantMemory.createMany({ data: MEMORIES.map((m) => ({ workspaceId: workspace.id, ...m, source: "manual", createdById: owner?.userId ?? null })) });

  await prisma.scheduledJob.deleteMany({ where: { workspaceId: workspace.id, name: JOB_NAME } });
  await prisma.scheduledJob.create({
    data: {
      workspaceId: workspace.id,
      name: JOB_NAME,
      cron: "0 8 * * *",
      timezone: workspace.timezone,
      prompt: "Write this morning's digest for the community: tasks due today or overdue (with owners), what moved to done yesterday, today's events or build nights, new announcements. Skip empty sections.",
      channelId: general?.id ?? null,
      enabled: false,
      createdById: owner?.userId ?? null,
    },
  });

  await prisma.boardroomSession.deleteMany({ where: { workspaceId: workspace.id, title: SESSION_TITLE } });
  const session = await prisma.boardroomSession.create({
    data: {
      workspaceId: workspace.id,
      title: SESSION_TITLE,
      question: "Should we spend ₹60,000 from the kitty on a second laser cutter this quarter?",
      status: "DONE",
      rounds: 1,
      createdById: owner?.userId ?? null,
      summary: "## Recommendation\nWait one quarter and lease a second cutter for the workshop season instead of buying.\n\n## Why\n- The kitty would drop below three months of rent.\n- Booking data shows the queue only at weekends.\n\n## Dissent\nThe Maker seat would buy now: weekend queues block workshops.\n\n## Next steps\n- Ask two vendors for lease quotes.\n- Track laser bookings for eight weeks.",
      seats: {
        create: [
          { name: "Treasurer", persona: "Looks after the kitty: cost, cash flow and value for money.", position: 0 },
          { name: "Maker", persona: "Builds every week and cares about what is practical to make and maintain.", position: 1 },
        ],
      },
    },
    select: { id: true, seats: { orderBy: { position: "asc" }, select: { id: true } } },
  });
  const [treasurer, maker] = session.seats;
  await prisma.boardroomTurn.createMany({
    data: [
      { sessionId: session.id, seatId: treasurer.id, round: 1, role: "SEAT", content: "₹60,000 is most of the kitty. Rent is due in two months; I would rather lease for the workshop season." },
      { sessionId: session.id, seatId: maker.id, round: 1, role: "SEAT", content: "Weekend queues for the laser are blocking workshops. A second machine pays for itself in workshop fees." },
    ],
  });

  console.log(`Seeded assistant demo data in /w/${SLUG}/assistant and /w/${SLUG}/boardroom`);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
