#!/usr/bin/env node
// Seeds a demo community workspace, "TinkerSpace Kochi", with members,
// channels, labels, a project board, tasks and a little community activity
// for local development and demos. Refuses to run with NODE_ENV=production.
//
//   DEMO_PASSWORD=... node --env-file-if-exists=.env scripts/seed-demo.mjs
//
// Idempotent: re-running replaces the demo workspace and its @tinkerspace.test users.
// Mirrors the defaults in lib/workspaceDefaults.ts.
import { existsSync, readdirSync } from "node:fs";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

if (process.env.NODE_ENV === "production") throw new Error("seed-demo is for local development only.");
const password = process.env.DEMO_PASSWORD;
if (!password || password.length < 12) throw new Error("Set DEMO_PASSWORD (12+ characters) to seed the demo members.");

const prisma = new PrismaClient();
const SLUG = "tinkerspace-kochi";
const DOMAIN = "@tinkerspace.test";

const PEOPLE = [
  { key: "owner", name: "Anjali Menon", email: `owner${DOMAIN}`, role: "OWNER", title: "Community lead", skills: ["Community", "Electronics"], bio: "Keeps the lights on and the soldering irons warm." },
  { key: "admin", name: "Rahul Varghese", email: `admin${DOMAIN}`, role: "ADMIN", title: "Space manager", skills: ["3D printing", "CAD", "Finance"], bio: "Runs the kitty and the print farm." },
  { key: "meera", name: "Meera Nair", email: `meera${DOMAIN}`, role: "MEMBER", title: "Hardware", skills: ["PCB design", "KiCad", "Soldering"], bio: "Boards, boards, boards." },
  { key: "joel", name: "Joel Thomas", email: `joel${DOMAIN}`, role: "MEMBER", title: "Firmware", skills: ["Embedded C", "Rust", "ESP32"], bio: null },
  { key: "fathima", name: "Fathima Rahman", email: `fathima${DOMAIN}`, role: "MEMBER", title: null, skills: ["Python", "Computer vision"], bio: "Teaching robots to see." },
  { key: "guest", name: "Vivek Pillai", email: `guest${DOMAIN}`, role: "GUEST", title: "Visiting mentor", skills: ["Mechanical design"], bio: null },
];

const CHANNELS = [
  { slug: "general", name: "general", topic: "Everything the crew needs to know.", isDefault: true },
  { slug: "announcements", name: "announcements", topic: "News from the organisers.", isDefault: true },
  { slug: "random", name: "random", topic: "Show-and-tell, links and everything else.", isDefault: true },
  { slug: "hardware", name: "hardware", topic: "Boards, parts and the soldering station.", isDefault: false },
];

const LABELS = [
  { name: "Bug", tone: "DANGER" },
  { name: "Idea", tone: "INFO" },
  { name: "Help wanted", tone: "WARNING" },
  { name: "Hardware", tone: "ACCENT" },
  { name: "Software", tone: "SUCCESS" },
];

const COLUMNS = [
  { name: "To do", category: "TODO" },
  { name: "In progress", category: "IN_PROGRESS" },
  { name: "Review", category: "IN_PROGRESS" },
  { name: "Done", category: "DONE" },
];

const CATEGORIES = [
  { name: "Member contributions", kind: "INCOME" },
  { name: "Sponsorship", kind: "INCOME" },
  { name: "Workshop fees", kind: "INCOME" },
  { name: "Space rent", kind: "EXPENSE" },
  { name: "Components and tools", kind: "EXPENSE" },
  { name: "Food and snacks", kind: "EXPENSE" },
];

function daysFromNow(days, hour = 18) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(hour - 5, 30, 0, 0); // hour in IST
  return date;
}

function dateOnly(daysAgo) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

async function main() {
  await prisma.workspace.deleteMany({ where: { slug: SLUG } });
  await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });

  const passwordHash = await bcrypt.hash(password, 12);
  const users = {};
  for (const person of PEOPLE) {
    users[person.key] = await prisma.user.create({
      data: { name: person.name, email: person.email, passwordHash, emailVerified: new Date(), skills: person.skills, bio: person.bio, timezone: "Asia/Kolkata" },
    });
  }

  const workspace = await prisma.workspace.create({
    data: {
      slug: SLUG,
      name: "TinkerSpace Kochi",
      tagline: "Make things together, every Saturday.",
      description: "A maker and hacker community in Kochi: build nights, workshops and a shared workbench.",
      timezone: "Asia/Kolkata",
      currency: "INR",
      financeVisibleToMembers: true,
      blogEnabled: true,
      memberships: { create: PEOPLE.map((p) => ({ userId: users[p.key].id, role: p.role, title: p.title })) },
    },
  });

  const channels = {};
  for (const channel of CHANNELS) {
    const memberKeys = channel.isDefault ? PEOPLE.map((p) => p.key) : ["owner", "meera", "joel", "guest"];
    channels[channel.slug] = await prisma.channel.create({
      data: {
        workspaceId: workspace.id,
        slug: channel.slug,
        name: channel.name,
        topic: channel.topic,
        kind: "PUBLIC",
        isDefault: channel.isDefault,
        createdById: users.owner.id,
        members: { create: memberKeys.map((key) => ({ userId: users[key].id })) },
      },
    });
  }

  const labels = {};
  for (const label of LABELS) labels[label.name] = await prisma.label.create({ data: { workspaceId: workspace.id, ...label } });
  const categories = {};
  for (const category of CATEGORIES) categories[category.name] = await prisma.financeCategory.create({ data: { workspaceId: workspace.id, ...category } });

  const project = await prisma.project.create({
    data: {
      workspaceId: workspace.id,
      key: "BOT",
      name: "Line-follower robot",
      description: "A small line-follower for the school outreach workshop in December.",
      ownerId: users.meera.id,
      startsOn: dateOnly(14),
      dueOn: dateOnly(-30),
    },
  });
  const columns = [];
  for (const [position, column] of COLUMNS.entries()) {
    columns.push(await prisma.boardColumn.create({ data: { projectId: project.id, name: column.name, category: column.category, position } }));
  }

  const TASKS = [
    { title: "Pick a motor driver (TB6612 vs DRV8833)", column: 3, assignees: ["meera"], labels: ["Hardware"], priority: "MEDIUM", done: true },
    { title: "Design the sensor bar PCB", column: 2, assignees: ["meera"], labels: ["Hardware"], priority: "HIGH" },
    { title: "PID controller for line tracking", column: 1, assignees: ["joel"], labels: ["Software"], priority: "HIGH", due: 5 },
    { title: "Calibrate IR sensors on the practice track", column: 1, assignees: ["fathima", "joel"], labels: ["Software"], priority: "MEDIUM", due: 9 },
    { title: "3D print chassis v2", column: 0, assignees: ["admin"], labels: ["Hardware", "Help wanted"], priority: "LOW" },
    { title: "Write the workshop handout", column: 0, assignees: [], labels: ["Idea"], priority: "NONE", due: 21 },
    { title: "Robot drifts left on long straights", column: 0, assignees: ["joel"], labels: ["Bug"], priority: "URGENT", due: 2 },
  ];
  let number = 0;
  for (const [index, task] of TASKS.entries()) {
    number += 1;
    await prisma.task.create({
      data: {
        workspaceId: workspace.id,
        projectId: project.id,
        columnId: columns[task.column].id,
        number,
        title: task.title,
        priority: task.priority,
        position: index + 1,
        dueAt: task.due ? daysFromNow(task.due) : null,
        completedAt: task.done ? daysFromNow(-3) : null,
        creatorId: users.owner.id,
        assignees: { create: task.assignees.map((key) => ({ userId: users[key].id })) },
        labels: { create: task.labels.map((name) => ({ labelId: labels[name].id })) },
        activities: { create: { actorId: users.owner.id, kind: "created" } },
      },
    });
  }
  await prisma.workspaceCounter.create({ data: { workspaceId: workspace.id, name: "task", value: number } });

  const MESSAGES = [
    { channel: "general", author: "owner", body: "Welcome to the new workspace, crew. Projects, chat and docs all live here now." },
    { channel: "general", author: "meera", body: "The sensor bar PCB is ready for review. Gerbers are in the BOT project." },
    { channel: "general", author: "joel", body: "Nice. I'll bring the practice track on Saturday." },
    { channel: "hardware", author: "admin", body: "Restocked M3 screws and 1kΩ resistors. The kitty covered it." },
    { channel: "random", author: "fathima", body: "Anyone up for a trip to the electronics market on Sunday?" },
  ];
  for (const [index, message] of MESSAGES.entries()) {
    await prisma.message.create({
      data: { workspaceId: workspace.id, channelId: channels[message.channel].id, authorId: users[message.author].id, body: message.body, createdAt: new Date(Date.now() - (MESSAGES.length - index) * 3_600_000) },
    });
  }

  await prisma.announcement.create({
    data: { workspaceId: workspace.id, title: "Build night this Saturday", body: "Doors open at 6 PM. Bring your half-finished projects and something to share.", authorId: users.owner.id, pinned: true, publishedAt: new Date() },
  });
  const buildNight = await prisma.communityEvent.create({
    data: { workspaceId: workspace.id, title: "Saturday build night", description: "Open workbench and show-and-tell.", location: "TinkerSpace, Kakkanad", startsAt: daysFromNow(4, 18), endsAt: daysFromNow(4, 22), kind: "BUILD_NIGHT", createdById: users.owner.id },
  });
  await prisma.eventAttendee.createMany({ data: ["owner", "meera", "joel"].map((key) => ({ eventId: buildNight.id, userId: users[key].id, status: "GOING" })) });
  await prisma.communityEvent.create({
    data: { workspaceId: workspace.id, title: "Intro to soldering workshop", location: "TinkerSpace, Kakkanad", startsAt: daysFromNow(11, 10), endsAt: daysFromNow(11, 13), kind: "WORKSHOP", createdById: users.admin.id },
  });
  await prisma.shoutout.create({ data: { workspaceId: workspace.id, fromId: users.joel.id, toId: users.meera.id, message: "For turning the sensor bar around in two evenings." } });

  await prisma.ledgerEntry.createMany({
    data: [
      { workspaceId: workspace.id, kind: "INCOME", amountMinor: 1_200_000, currency: "INR", categoryId: categories["Member contributions"].id, description: "October contributions", occurredOn: dateOnly(18), createdById: users.admin.id },
      { workspaceId: workspace.id, kind: "INCOME", amountMinor: 500_000, currency: "INR", categoryId: categories["Workshop fees"].id, description: "Arduino basics workshop", counterparty: "Workshop attendees", occurredOn: dateOnly(10), createdById: users.admin.id },
      { workspaceId: workspace.id, kind: "EXPENSE", amountMinor: 800_000, currency: "INR", categoryId: categories["Space rent"].id, description: "October rent", counterparty: "Landlord", occurredOn: dateOnly(15), createdById: users.admin.id },
      { workspaceId: workspace.id, kind: "EXPENSE", amountMinor: 184_550, currency: "INR", categoryId: categories["Components and tools"].id, description: "Motor drivers and IR sensors", counterparty: "Local electronics market", occurredOn: dateOnly(6), createdById: users.admin.id },
    ],
  });

  await prisma.doc.create({
    data: {
      workspaceId: workspace.id,
      title: "Space rules",
      contentHtml: "<h2>Space rules</h2><ul><li>Leave the bench cleaner than you found it.</li><li>Unplug irons before you go.</li><li>Ask before using the laser cutter.</li></ul>",
      contentText: "Space rules. Leave the bench cleaner than you found it. Unplug irons before you go. Ask before using the laser cutter.",
      createdById: users.owner.id,
      updatedById: users.owner.id,
    },
  });

  // Area seed modules: every scripts/seed/<area>.mjs exports one async
  // function taking (prisma, { workspaceId, workspace, users, channels }).
  // They run in name order after the core demo data.
  const seedDir = new URL("./seed/", import.meta.url);
  const modules = existsSync(seedDir) ? readdirSync(seedDir).filter((name) => name.endsWith(".mjs")).sort() : [];
  for (const name of modules) {
    const exported = Object.values(await import(new URL(name, seedDir).href)).filter((value) => typeof value === "function");
    for (const seed of exported) await seed(prisma, { workspaceId: workspace.id, workspace, users, channels });
  }

  console.log(`Seeded ${workspace.name} at /w/${SLUG}`);
  console.log(`Members (password from DEMO_PASSWORD): ${PEOPLE.map((p) => `${p.email} (${p.role.toLowerCase()})`).join(", ")}`);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
