"use server";
import { z } from "zod";
import { requireSuperAdminMfa } from "@/lib/permissions";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { recordAuditEvent } from "@/lib/audit";
import { actionError, RATE_LIMITED, type ActionResult } from "@/lib/actionResult";
import { revalidatePath } from "@/lib/frontend/cache";
import { QUEUE_NAMES } from "@/lib/queue/definitions";
import { manageQueue } from "@/lib/queue/admin";

export async function manageJobsAction(input: unknown): Promise<ActionResult> {
  const session = await requireSuperAdminMfa();
  if (await isActionRateLimited("action", session.user.id)) return actionError(RATE_LIMITED);
  const parsed = z.object({ queue: z.enum(QUEUE_NAMES), operation: z.enum(["pause", "resume", "retry", "remove"]), jobId: z.string().min(1).max(256).optional() }).safeParse(input);
  if (!parsed.success || (["retry", "remove"].includes(parsed.data.operation) && !parsed.data.jobId)) return actionError("Choose a queue and a failed job.");
  try { await manageQueue(parsed.data); }
  catch { return actionError("The queue could not be updated. Refresh and try again."); }
  await recordAuditEvent({ action: `admin.jobs_${parsed.data.operation}`, actorId: session.user.id, targetType: "Queue", targetId: parsed.data.queue, metadata: { jobId: parsed.data.jobId ?? null } });
  revalidatePath("/admin/jobs");
  return { ok: true };
}
