#!/usr/bin/env node
// Demo docs and files for the "TinkerSpace Kochi" workspace (run after
// `npm run db:seed:demo`). Idempotent: removes what it created before and
// recreates it. Files are stored only when S3_BUCKET is configured.
//
//   node --env-file-if-exists=.env scripts/seed/docsfiles.mjs
import { createHash, randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { PrismaClient } from "@prisma/client";

const SLUG = process.env.DEMO_WORKSPACE_SLUG ?? "tinkerspace-kochi";
const TITLES = ["Member handbook", "Soldering station how-to", "Laser cutter runbook", "Build night notes", "Line follower bot: week 3", "Keyholder procedures"];
const prisma = new PrismaClient();

const s3 = process.env.S3_BUCKET && process.env.S3_REGION
  ? new S3Client({
      region: process.env.S3_REGION,
      ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "1",
      ...(process.env.S3_ACCESS_KEY_ID ? { credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "" } } : {}),
    })
  : null;

const text = (html) => html.replace(/<\/(p|h[1-6]|li|pre)>/g, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\n{2,}/g, "\n").trim();

async function main() {
  const workspace = await prisma.workspace.findUnique({ where: { slug: SLUG } });
  if (!workspace) {
    console.log(`Workspace ${SLUG} not found. Run npm run db:seed:demo first.`);
    return;
  }
  const people = await prisma.user.findMany({ where: { memberships: { some: { workspaceId: workspace.id } } }, select: { id: true, email: true } });
  const by = (prefix) => people.find((person) => person.email.startsWith(prefix))?.id ?? null;
  const owner = by("owner@");
  const admin = by("admin@");
  const meera = by("meera@");
  const joel = by("joel@");

  // Idempotency: remove this script's docs (by title) and files (checksum prefix) before recreating them.
  const previous = await prisma.doc.findMany({ where: { workspaceId: workspace.id, title: { in: TITLES } }, select: { id: true } });
  await prisma.searchDocument.deleteMany({ where: { entityType: "doc", entityId: { in: previous.map((doc) => doc.id) } } });
  await prisma.doc.deleteMany({ where: { id: { in: previous.map((doc) => doc.id) } } });
  const oldFiles = await prisma.fileObject.findMany({ where: { workspaceId: workspace.id, checksum: { startsWith: "seed-" } }, select: { id: true } });
  await prisma.searchDocument.deleteMany({ where: { entityType: "file", entityId: { in: oldFiles.map((file) => file.id) } } });
  await prisma.fileObject.deleteMany({ where: { id: { in: oldFiles.map((file) => file.id) } } });

  let position = 100;
  async function doc({ title, html, parentId = null, createdById, visibility = "WORKSPACE", verifiedDays = null }) {
    const contentText = text(html);
    const created = await prisma.doc.create({
      data: {
        workspaceId: workspace.id, parentId, title, contentHtml: html, contentText, visibility, position: position++,
        createdById, updatedById: createdById,
        ...(verifiedDays !== null ? { verifiedUntil: new Date(Date.now() + verifiedDays * 86_400_000), verifiedById: createdById } : {}),
      },
    });
    await prisma.docRevision.create({ data: { docId: created.id, title, contentHtml: html, authorId: createdById } });
    if (visibility === "WORKSPACE") {
      await prisma.searchDocument.upsert({
        where: { entityType_entityId: { entityType: "doc", entityId: created.id } },
        create: { workspaceId: workspace.id, entityType: "doc", entityId: created.id, title, body: text(html), url: `/w/${SLUG}/docs/${created.id}`, ownerId: createdById },
        update: {},
      });
    }
    return created;
  }

  const handbook = await doc({
    title: "Member handbook",
    createdById: owner,
    verifiedDays: 120,
    html: "<p>Everything a new member needs for their first build night.</p><h2>Getting in</h2><p>The space is open on Saturdays from 4 PM. Ask a keyholder at the door.</p><h2>First steps</h2><ul data-type=\"taskList\"><li data-type=\"taskItem\" data-checked=\"true\"><p>Join #general</p></li><li data-type=\"taskItem\" data-checked=\"false\"><p>Do the soldering sign-off</p></li></ul>",
  });
  await doc({
    title: "Soldering station how-to",
    parentId: handbook.id,
    createdById: meera,
    verifiedDays: 3,
    html: "<h2>You will need</h2><ul><li><p>Iron at 330 °C</p></li><li><p>Lead-free solder</p></li></ul><h2>Steps</h2><ol><li><p>Tin the tip.</p></li><li><p>Heat the pad, then feed solder.</p></li></ol><pre><code class=\"language-text\">Clean tip -> tin -> solder -> clean tip</code></pre>",
  });
  await doc({
    title: "Laser cutter runbook",
    parentId: handbook.id,
    createdById: joel,
    verifiedDays: -5,
    html: "<p><strong>Owner:</strong> Joel</p><h2>Settings</h2><table><tbody><tr><th><p>Material</p></th><th><p>Power</p></th><th><p>Speed</p></th></tr><tr><td><p>3 mm plywood</p></td><td><p>55%</p></td><td><p>12 mm/s</p></td></tr><tr><td><p>Acrylic</p></td><td><p>60%</p></td><td><p>8 mm/s</p></td></tr></tbody></table><blockquote><p>Never leave the cutter running alone.</p></blockquote>",
  });
  const notes = await doc({ title: "Build night notes", createdById: meera, html: "<p>Notes from Saturday build nights.</p>" });
  await doc({ title: "Line follower bot: week 3", parentId: notes.id, createdById: joel, html: "<h2>Done</h2><ul><li><p>Motor driver wired</p></li></ul><h2>Next</h2><ul><li><p>Tune PID</p></li></ul>" });
  await doc({ title: "Keyholder procedures", createdById: admin, visibility: "ADMINS", html: "<p>Admin-only: opening, closing and alarm steps for keyholders.</p>" });

  if (!s3) {
    console.log("Seeded demo docs. S3_BUCKET is not set, so no demo files were stored.");
    return;
  }
  async function file({ name, folder, body, type, uploadedById, docId = null }) {
    const id = randomUUID();
    const storageKey = `workspaces/${workspace.id}/files/${id}/${name.replace(/[^A-Za-z0-9._-]/g, "_")}`;
    const buffer = Buffer.from(body);
    await s3.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: storageKey, Body: buffer, ContentType: type }));
    const created = await prisma.fileObject.create({
      data: { workspaceId: workspace.id, storageKey, filename: name, contentType: type, size: buffer.length, checksum: `seed-${createHash("sha256").update(buffer).digest("hex").slice(0, 32)}`, uploadedById, folder, docId },
    });
    await prisma.searchDocument.create({ data: { workspaceId: workspace.id, entityType: "file", entityId: created.id, title: name, body: folder === "/" ? "" : folder, url: `/w/${SLUG}/files/${created.id}`, ownerId: uploadedById } });
    return created;
  }
  await file({ name: "bill-of-materials.csv", folder: "/builds/line-follower", type: "text/csv", uploadedById: joel, body: "part,qty,cost\nL298N driver,1,180\nIR sensor,5,40\nN20 motor,2,220\n" });
  await file({ name: "wiring-notes.md", folder: "/builds/line-follower", type: "text/markdown", uploadedById: meera, body: "# Wiring\n\n- ENA to D5\n- ENB to D6\n" });
  await file({ name: "workshop-checklist.txt", folder: "/", type: "text/plain", uploadedById: owner, body: "Projector\nExtension cords\nSolder kits x6\n" });
  console.log("Seeded demo docs and files.");
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
