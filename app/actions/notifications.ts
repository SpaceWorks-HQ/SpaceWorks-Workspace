"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/permissions";
import { markNotificationsRead } from "@/lib/notifications";
import { actionError, type ActionResult } from "@/lib/actionResult";

const schema = z.object({ ids: z.array(z.string().min(1).max(64)).max(200).optional() });

/** Mark the caller's own notifications read (all of them when `ids` is omitted). */
export async function markNotificationsReadAction(input: unknown): Promise<ActionResult<{ count: number }>> {
  const user = await getCurrentUser();
  if (!user) return actionError("Sign in again to continue.");
  const parsed = schema.safeParse(input ?? {});
  if (!parsed.success) return actionError("Couldn't update notifications. Try again.");
  const count = await markNotificationsRead(user.id, parsed.data.ids);
  revalidatePath("/w", "layout");
  return { ok: true, data: { count } };
}
