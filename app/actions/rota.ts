"use server";
import { actionError, type ActionResult } from "@/lib/actionResult";
import { actionContext, isFailure, refreshArea } from "@/lib/people/actionContext";
import { acceptSwap, dropShift, requestSwap, saveShiftType, scheduleShifts, signUp } from "@/lib/rota/rota";
import { idSchema } from "@/lib/validation";
export async function mutateRota(slug: string, operation: string, input: unknown): Promise<ActionResult<unknown>> {
  const ctx = await actionContext(slug); if (isFailure(ctx)) return ctx;
  let result: ActionResult<unknown>;
  switch (operation) {
    case "template": result = await saveShiftType(ctx, input); break;
    case "schedule": result = await scheduleShifts(ctx, input); break;
    case "swap": result = await requestSwap(ctx, input); break;
    case "signup": case "drop": case "acceptSwap": {
      const p = idSchema.safeParse(input); if (!p.success) return actionError("Pick a shift.");
      result = operation === "signup" ? await signUp(ctx, p.data) : operation === "drop" ? await dropShift(ctx, p.data) : await acceptSwap(ctx, p.data); break;
    }
    default: return actionError("That action is unavailable.");
  }
  if (result.ok) refreshArea(ctx.workspace.slug, "rota"); return result;
}
