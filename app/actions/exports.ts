"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { shellContext } from "@/lib/shell/context";
import { actionError, type ActionResult } from "@/lib/actionResult";
import { RETENTION_AREAS } from "@/lib/shell/retention";
import { parseCsv, mapLinkRows, csvMappingSchema } from "@/lib/shell/csv";
import { uploadWorkspaceFile } from "@/lib/storage";
export async function requestWorkspaceExport(
  slug: string,
  input: unknown,
): Promise<ActionResult> {
  const ctx = await shellContext(slug, "ADMIN");
  const parsed = z
    .object({
      includeMessages: z.boolean().default(false),
      format: z.enum(["ZIP_JSON", "JSON"]).default("ZIP_JSON"),
    })
    .safeParse(input);
  if (!ctx || !parsed.success)
    return actionError("You don't have access to request this export.");
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${ctx.workspace.id} FOR UPDATE`;
      if (
        await tx.exportJob.count({
          where: {
            workspaceId: ctx.workspace.id,
            status: { in: ["QUEUED", "RUNNING"] },
          },
        })
      )
        throw new Error("pending");
      const job = await tx.exportJob.create({
        data: {
          workspaceId: ctx.workspace.id,
          requestedById: ctx.user.id,
          scope: { includeMessages: parsed.data.includeMessages },
          format: parsed.data.format,
        },
      });
      await recordAuditEvent({
        workspaceId: ctx.workspace.id,
        actorId: ctx.user.id,
        action: "shell.export_requested",
        targetId: job.id,
        client: tx,
      });
    });
    revalidatePath(`/w/${slug}/settings/export`);
    return { ok: true };
  } catch {
    return actionError(
      "Couldn't queue an export. Wait for any pending export, then try again.",
    );
  }
}
export async function saveRetentionPolicy(
  slug: string,
  input: unknown,
): Promise<ActionResult> {
  const ctx = await shellContext(slug, "ADMIN");
  const parsed = z
    .object({
      entityType: z.string().refine((s) => Object.hasOwn(RETENTION_AREAS, s)),
      keepDays: z.number().int().min(1).max(36500).nullable(),
    })
    .safeParse(input);
  if (!ctx || !parsed.success)
    return actionError(
      "Choose an area and a retention period from 1 to 36,500 days.",
    );
  try {
    await prisma.$transaction(async (tx) => {
      const key = {
        workspaceId: ctx.workspace.id,
        entityType: parsed.data.entityType,
      };
      if (parsed.data.keepDays === null)
        await tx.retentionPolicy.deleteMany({ where: key });
      else
        await tx.retentionPolicy.upsert({
          where: { workspaceId_entityType: key },
          create: {
            ...key,
            keepDays: parsed.data.keepDays,
            updatedById: ctx.user.id,
          },
          update: {
            keepDays: parsed.data.keepDays,
            action: "DELETE",
            updatedById: ctx.user.id,
          },
        });
      await recordAuditEvent({
        workspaceId: ctx.workspace.id,
        actorId: ctx.user.id,
        action: "shell.retention_updated",
        metadata: { area: key.entityType, keepDays: parsed.data.keepDays },
        client: tx,
      });
    });
    revalidatePath(`/w/${slug}/settings/retention`);
    return { ok: true };
  } catch {
    return actionError("Couldn't save retention. Try again.");
  }
}
export async function saveWorkspaceShellSettings(
  slug: string,
  input: unknown,
): Promise<ActionResult> {
  const ctx = await shellContext(slug, "ADMIN");
  const parsed = z
    .object({
      legalHold: z.boolean(),
      defaultLocale: z.string().refine((s) => {
        try {
          return Intl.getCanonicalLocales(s).length === 1;
        } catch {
          return false;
        }
      }),
    })
    .safeParse(input);
  if (!ctx || !parsed.success)
    return actionError("Enter a valid locale and try again.");
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${ctx.workspace.id} FOR UPDATE`;
    await tx.workspace.update({
      where: { id: ctx.workspace.id },
      data: parsed.data,
    });
    await recordAuditEvent({
      workspaceId: ctx.workspace.id,
      actorId: ctx.user.id,
      action: "shell.workspace_settings_updated",
      metadata: parsed.data,
      client: tx,
    });
  });
  revalidatePath(`/w/${slug}`, "layout");
  return { ok: true };
}
export async function queueCsvImport(
  slug: string,
  form: FormData,
): Promise<ActionResult> {
  const ctx = await shellContext(slug, "ADMIN");
  if (!ctx) return actionError("You don't have access to import links.");
  const file = form.get("file");
  if (
    !(file instanceof File) ||
    file.size > 1_000_000 ||
    !file.name.toLowerCase().endsWith(".csv")
  )
    return actionError("Choose a CSV file smaller than 1 MB.");
  const mapping = csvMappingSchema.safeParse({
    title: form.get("title"),
    url: form.get("url"),
    description: form.get("description") || undefined,
    tags: form.get("tags") || undefined,
  });
  if (!mapping.success) return actionError("Choose the title and URL columns.");
  try {
    const rows = mapLinkRows(parseCsv(await file.text()), mapping.data);
    if (!rows.length) return actionError("Add at least one data row.");
    // The import framework currently owns only links; other areas register their own writer.
    const stored = await uploadWorkspaceFile({
      workspaceId: ctx.workspace.id,
      uploadedById: ctx.user.id,
      file: new File([file], file.name, { type: "text/csv" }),
      folder: "/imports",
      allowedTypes: new Set(["text/csv"]),
      maxBytes: 1_000_000,
    });
    if (!stored.ok) return actionError(stored.error);
    await prisma.$transaction(async (tx) => {
      const job = await tx.importJob.create({
        data: {
          workspaceId: ctx.workspace.id,
          requestedById: ctx.user.id,
          entityType: "link",
          sourceFileId: stored.file.id,
          mapping: mapping.data,
          dryRun: form.get("dryRun") !== "false",
        },
      });
      await recordAuditEvent({
        workspaceId: ctx.workspace.id,
        actorId: ctx.user.id,
        action: "shell.import_requested",
        targetId: job.id,
        client: tx,
      });
    });
    revalidatePath(`/w/${slug}/settings/import`);
    return { ok: true };
  } catch (error) {
    return actionError(
      error instanceof Error &&
        /CSV|column|row|quoted|quote/.test(error.message)
        ? error.message
        : "Couldn't queue the import. Try again.",
    );
  }
}
