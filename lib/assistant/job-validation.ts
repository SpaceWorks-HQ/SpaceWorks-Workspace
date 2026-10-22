import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { idSchema, timeZoneSchema } from "@/lib/validation";
import { validateCron } from "@/lib/assistant/cron";

export const jobSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a name.").max(80),
    cron: z.string().trim().min(9, "Enter a schedule.").max(100),
    timezone: timeZoneSchema,
    prompt: z.string().trim().min(10, "Tell the assistant what to do.").max(4000),
    channelId: idSchema.nullable().default(null),
    destinationIds: z.array(idSchema).max(20).default([]),
    enabled: z.boolean().default(true),
  })
  .superRefine((value, issue) => {
    const check = validateCron(value.cron, value.timezone);
    if (!check.ok) issue.addIssue({ code: "custom", path: ["cron"], message: check.error });
  });

export async function checkChannel(workspaceId: string, channelId: string | null) {
  if (!channelId) return true;
  const channel = await prisma.channel.findFirst({ where: { id: channelId, workspaceId, archivedAt: null, kind: { not: "DIRECT" } }, select: { id: true } });
  return Boolean(channel);
}

