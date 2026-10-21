import "server-only";
import { prisma } from "@/lib/db";
import { canManageSecrets } from "@/lib/roles";
import { guard } from "@/lib/approvals/ops";
import { requireSecretsMfa, type SecretsActor } from "./access";
import { audit } from "./mutations";
import { openValue, sealValue, openPayload, sealPayload } from "./encryption";
import { rotateHierarchyKey, openStored, sealStored, vaultBinding } from "@/lib/vault/hierarchy";
import { SecretsError } from "./values";
import { getQueues } from "@/lib/queue/client";
import { jobId } from "@/lib/queue/definitions";
export async function requestKeyRotation(actor: SecretsActor, projectId: string, kind: string) {
  await guard(actor, true);
  if (!canManageSecrets(actor.membership) || actor.machine || !["project", "workspace"].includes(kind)) throw new SecretsError("Ask a workspace admin to rotate keys.");
  await requireSecretsMfa(actor, true);
  const row = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id"=${actor.workspace.id} FOR UPDATE`;
    const project = await tx.secretProject.findFirst({ where: { workspaceId: actor.workspace.id, id: projectId } });
    if (!project) throw new SecretsError("That project is unavailable.");
    const pending = await tx.secretKeyRotation.findFirst({ where: { workspaceId: actor.workspace.id, status: { in: ["PENDING", "RUNNING"] } } });
    if (pending) throw new SecretsError("A key rotation is already running. Wait for it to finish.");
    const job = await tx.secretKeyRotation.create({ data: { workspaceId: actor.workspace.id, projectId, kind, createdById: actor.user.id } });
    await audit(tx, actor.workspace.id, projectId, actor.user.id, "key_rotation_requested", undefined, job.id);
    return job;
  });
  await enqueueRotation(row.id).catch(() => undefined); // Durable SQL record is retried by the registered job.
  return { id: row.id };
}
export async function enqueueRotation(id: string) {
  await getQueues().scheduled.add("secrets-key-rotation", { kind: "secrets-rotation", rotationId: id }, { jobId: jobId("rotation", id + ":" + Math.floor(Date.now() / 60000)) });
}
/** A transaction commits a batch and its cursor together. Retrying never skips a record. */
export async function runKeyRotation(id: string, batchSize = 20, maxBatches = Infinity) {
  for (let batch = 0; batch < maxBatches; batch++) {
    const done = await prisma.$transaction(async tx => {
      const lock = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${"key-rotation:" + id})) AS locked`;
      if (!lock[0]?.locked) return true;
      const job = await tx.secretKeyRotation.findUnique({ where: { id } });
      if (!job || job.status === "COMPLETE") return true;
      if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new Error("Invalid rotation batch size.");
      await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id"=${job.workspaceId} FOR UPDATE`;
      const workspaceId = job.workspaceId, projectId = job.projectId;
      if (job.status === "PENDING") {
        await rotateHierarchyKey(workspaceId, projectId, job.kind, tx);
        const total = await tx.applicationSecret.count({ where: { workspaceId, environment: { projectId } } }) + await tx.applicationSecretVersion.count({ where: { workspaceId, secret: { environment: { projectId } } } }) + await tx.secretSnapshot.count({ where: { workspaceId, environment: { projectId } } }) + await tx.secretChange.count({ where: { workspaceId, environment: { projectId } } }) + (job.kind === "workspace" ? await tx.vaultItem.count({ where: { workspaceId } }) + await tx.vaultItemVersion.count({ where: { item: { workspaceId } } }) : 0);
        await tx.secretKeyRotation.update({ where: { id, workspaceId }, data: { status: "RUNNING", cursor: "0:", total } });
        return false;
      }
      const [stageString, after = ""] = (job.cursor ?? "0:").split(":"), stage = Number(stageString);
      const cursor = after ? { id: { gt: after } } : {};
      let last = "", count = 0;
      if (stage === 0) {
        const rows = await tx.applicationSecret.findMany({ where: { workspaceId, environment: { projectId }, ...cursor }, orderBy: { id: "asc" }, take: batchSize });
        for (const row of rows) { await tx.applicationSecret.update({ where: { id: row.id, workspaceId }, data: await sealValue(await openValue(row, tx), row, tx) }); last = row.id; count++; }
      } else if (stage === 1) {
        const rows = await tx.applicationSecretVersion.findMany({ where: { workspaceId, secret: { environment: { projectId } }, ...cursor }, include: { secret: true }, orderBy: { id: "asc" }, take: batchSize });
        for (const row of rows) { await tx.applicationSecretVersion.update({ where: { id: row.id, workspaceId }, data: await sealValue(await openValue(row, tx), row.secret, tx) }); last = row.id; count++; }
      } else if (stage === 2) {
        const rows = await tx.secretSnapshot.findMany({ where: { workspaceId, environment: { projectId }, ...cursor }, orderBy: { id: "asc" }, take: 1 });
        for (const row of rows) {
          const contents = JSON.parse(await openPayload(row, "snapshot", tx)) as import("@prisma/client").ApplicationSecret[];
          for (const item of contents) Object.assign(item, await sealValue(await openValue(item, tx), item, tx));
          await tx.secretSnapshot.update({ where: { id: row.id, workspaceId }, data: await sealPayload(workspaceId, row.environmentId, "snapshot", row.id, JSON.stringify(contents), tx) }); last = row.id; count++;
        }
      } else if (stage === 3) {
        const rows = await tx.secretChange.findMany({ where: { workspaceId, environment: { projectId }, ...cursor }, orderBy: { id: "asc" }, take: batchSize });
        for (const row of rows) { await tx.secretChange.update({ where: { id: row.id, workspaceId }, data: await sealPayload(workspaceId, row.environmentId, "change", row.id, await openPayload(row, "change", tx), tx) }); last = row.id; count++; }
      } else if (stage === 4 && job.kind === "workspace") {
        const rows = await tx.vaultItem.findMany({ where: { workspaceId, ...cursor }, orderBy: { id: "asc" }, take: batchSize });
        for (const row of rows) { await tx.vaultItem.update({ where: { id: row.id, workspaceId }, data: await sealStored(workspaceId, null, vaultBinding(row.id), await openStored(workspaceId, null, vaultBinding(row.id), row, tx), tx) }); last = row.id; count++; }
      } else if (stage === 5 && job.kind === "workspace") {
        const rows = await tx.vaultItemVersion.findMany({ where: { item: { workspaceId }, ...cursor }, orderBy: { id: "asc" }, take: batchSize });
        for (const row of rows) { await tx.vaultItemVersion.update({ where: { id: row.id, item: { workspaceId } }, data: await sealStored(workspaceId, null, vaultBinding(row.itemId), await openStored(workspaceId, null, vaultBinding(row.itemId), row, tx), tx) }); last = row.id; count++; }
      } else {
        await tx.secretKeyRotation.update({ where: { id, workspaceId }, data: { status: "COMPLETE", finishedAt: new Date() } });
        await audit(tx, workspaceId, projectId, null, "key_rotation_completed", undefined, id);
        return true;
      }
      await tx.secretKeyRotation.update({ where: { id, workspaceId }, data: { cursor: count ? `${stage}:${last}` : `${stage + 1}:`, processed: { increment: count } } });
      return false;
    }, { timeout: 60000, maxWait: 10000 });
    if (done) return;
  }
}
export async function resumeRotations() {
  const jobs = await prisma.secretKeyRotation.findMany({ where: { status: { in: ["PENDING", "RUNNING"] } }, select: { id: true }, take: 100 });
  for (const job of jobs) { if (process.env.REDIS_URL) await enqueueRotation(job.id); else await runKeyRotation(job.id); }
}
