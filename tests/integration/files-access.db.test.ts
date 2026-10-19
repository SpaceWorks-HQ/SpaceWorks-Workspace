import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { findDownloadableFile } from "@/lib/files";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const emailSuffix = `@files-chat-${suffix}.test`;
const slug = `files-chat-${suffix}`;

let workspaceId = "";
let owner = "";
let insider = "";
let outsider = "";
let guest = "";

async function attach(channelId: string, authorId: string, name: string) {
  const file = await prisma.fileObject.create({
    data: { workspaceId, storageKey: `workspaces/${workspaceId}/files/${suffix}-${name}`, filename: name, contentType: "text/plain", size: 4, uploadedById: authorId, folder: "/chat" },
  });
  const message = await prisma.message.create({ data: { workspaceId, channelId, authorId, body: "see attached" } });
  await prisma.messageAttachment.create({ data: { messageId: message.id, fileId: file.id } });
  return file.id;
}

async function channel(kind: "PUBLIC" | "PRIVATE" | "DIRECT", members: string[]) {
  const created = await prisma.channel.create({
    data: { workspaceId, name: `${kind.toLowerCase()}-${suffix}`, slug: `${kind.toLowerCase()}-${suffix}`, kind, createdById: owner, dmKey: kind === "DIRECT" ? members.slice().sort().join(":") : null },
  });
  await prisma.channelMember.createMany({ data: members.map((userId) => ({ channelId: created.id, userId })) });
  return created.id;
}

beforeAll(async () => {
  owner = (await createUser(`owner${emailSuffix}`)).id;
  insider = (await createUser(`insider${emailSuffix}`)).id;
  outsider = (await createUser(`outsider${emailSuffix}`)).id;
  guest = (await createUser(`guest${emailSuffix}`)).id;
  workspaceId = (await createWorkspace(slug, owner)).id;
  await addMember(workspaceId, insider);
  await addMember(workspaceId, outsider);
  await addMember(workspaceId, guest, "GUEST");
});

afterAll(async () => {
  await cleanup([slug], emailSuffix);
});

describe("task attachment downloads", () => {
  it("hides attachments on a private team's project from non-members of that team", async () => {
    const team = await prisma.team.create({ data: { workspaceId, name: `Ops ${suffix}`, slug: `ops-${suffix}`, visibility: "PRIVATE" } });
    await prisma.teamMember.create({ data: { teamId: team.id, userId: insider } });
    const project = await prisma.project.create({ data: { workspaceId, key: "OPS", name: "Ops", teamId: team.id } });
    const task = await prisma.task.create({ data: { workspaceId, projectId: project.id, number: 1, title: "Rotate keys", position: 1, creatorId: insider } });
    const file = await prisma.fileObject.create({
      data: { workspaceId, storageKey: `workspaces/${workspaceId}/files/${suffix}-task`, filename: "keys.txt", contentType: "text/plain", size: 4, uploadedById: insider, taskId: task.id },
    });
    expect(await findDownloadableFile(file.id, insider)).not.toBeNull();
    expect(await findDownloadableFile(file.id, owner)).not.toBeNull();
    expect(await findDownloadableFile(file.id, outsider)).toBeNull();
  });
});

describe("request receipt downloads", () => {
  it("limits purchase-request receipts to the requester and admins", async () => {
    const file = await prisma.fileObject.create({
      data: { workspaceId, storageKey: `workspaces/${workspaceId}/files/${suffix}-receipt`, filename: "receipt.pdf", contentType: "application/pdf", size: 4, uploadedById: insider },
    });
    await prisma.purchaseRequest.create({ data: { workspaceId, requesterId: insider, title: "Solder", items: [], totalMinor: 50_000, fileIds: [file.id] } });
    expect(await findDownloadableFile(file.id, insider)).not.toBeNull();
    expect(await findDownloadableFile(file.id, owner)).not.toBeNull();
    expect(await findDownloadableFile(file.id, outsider)).toBeNull();
  });
});

describe("chat attachment downloads", () => {
  it("limits private-channel attachments to channel members, even for owners", async () => {
    const fileId = await attach(await channel("PRIVATE", [insider]), insider, "private.txt");
    expect(await findDownloadableFile(fileId, insider)).not.toBeNull();
    expect(await findDownloadableFile(fileId, outsider)).toBeNull();
    expect(await findDownloadableFile(fileId, owner)).toBeNull();
  });

  it("limits DM attachments to the people in the DM", async () => {
    const fileId = await attach(await channel("DIRECT", [insider, owner]), insider, "dm.txt");
    expect(await findDownloadableFile(fileId, owner)).not.toBeNull();
    expect(await findDownloadableFile(fileId, outsider)).toBeNull();
  });

  it("lets members read public-channel attachments but not guests outside the channel", async () => {
    const fileId = await attach(await channel("PUBLIC", [insider]), insider, "public.txt");
    expect(await findDownloadableFile(fileId, outsider)).not.toBeNull();
    expect(await findDownloadableFile(fileId, guest)).toBeNull();
  });
});
