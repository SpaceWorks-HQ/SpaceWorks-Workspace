"use server";
import { actionError, type ActionResult } from "@/lib/actionResult";
import { actionContext, isFailure, refreshArea } from "@/lib/people/actionContext";
import { revealEmergencyContact, saveAdminProfile, saveEmergencyContact, saveOwnProfile } from "@/lib/people/profiles";
import { completeChecklist, saveChecklistTemplate, startChecklist, startOffboarding, tickChecklistItem } from "@/lib/people/onboarding";
import { decideTimeOff, requestTimeOff } from "@/lib/people/timeOff";
import { removeAvailability } from "@/lib/people/away";
import { grantCertification, revokeCertification, saveCertType } from "@/lib/people/certifications";
import { idSchema } from "@/lib/validation";
export async function mutatePeople(slug: string, operation: string, input: unknown): Promise<ActionResult<unknown>> {
  const ctx = await actionContext(slug); if (isFailure(ctx)) return ctx;
  let result: ActionResult<unknown>;
  switch (operation) {
    case "profile": result = await saveOwnProfile(ctx, input); break;
    case "adminProfile": { const p = input as { userId?: unknown }; if (!idSchema.safeParse(p?.userId).success) return actionError("Pick a member."); result = await saveAdminProfile(ctx, p.userId as string, input); break; }
    case "emergency": result = await saveEmergencyContact(ctx, input); break;
    case "template": { const data = input as { id?: unknown }; const id = data?.id ? idSchema.safeParse(data.id) : null; if (id && !id.success) return actionError("Pick a checklist template."); result = await saveChecklistTemplate(ctx, input, id?.success ? id.data : null); break; }
    case "start": result = await startChecklist(ctx, input); break;
    case "offboarding": result = await startOffboarding(ctx, input); break;
    case "tick": result = await tickChecklistItem(ctx, input); break;
    case "complete": result = await completeChecklist(ctx, input); break;
    case "requestTimeOff": result = await requestTimeOff(ctx, input); break;
    case "decideTimeOff": result = await decideTimeOff(ctx, input); break;
    case "removeAvailability": { const p = idSchema.safeParse(input); result = p.success ? await removeAvailability(ctx, p.data) : actionError("Pick an away period."); break; }
    case "certType": result = await saveCertType(ctx, input); break;
    case "grantCert": result = await grantCertification(ctx, input); break;
    case "revokeCert": { const p = idSchema.safeParse(input); result = p.success ? await revokeCertification(ctx, p.data) : actionError("Pick a sign-off."); break; }
    default: return actionError("That action is unavailable.");
  }
  if (result.ok) refreshArea(ctx.workspace.slug, "members", "onboarding", "settings/onboarding", "rota"); return result;
}
export async function revealEmergencyAction(slug: string, userId: string) {
  const ctx = await actionContext(slug); if (isFailure(ctx)) return ctx;
  const p = idSchema.safeParse(userId); if (!p.success) return actionError("Pick a member.");
  return revealEmergencyContact(ctx, p.data);
}
