"use server";
import { runAction, values, money, json } from "@/lib/approvals/action";
import { createRequest, requestSchema, completeRequest, createBudget, savePolicy, withdrawRequest, resubmitRequest, createGenericRequest } from "@/lib/requests/service";
import { decide, commentOnApproval } from "@/lib/approvals/engine";
import { uploadWorkspaceFile } from "@/lib/storage";
import { OpsError, parse } from "@/lib/approvals/ops";
import { z } from "zod";
export async function submitMoneyRequest(slug: string, form: FormData) {
 return runAction(slug, "requests", async actor => {
  const data = parse(requestSchema, { ...values(form), totalMinor: money(form) });
  const receiptFileIds: string[] = [];
  const files = form.getAll("receipts").filter((f): f is File => typeof f !== "string" && f.size > 0);
  if (files.length > 10) throw new OpsError("Attach at most ten receipts.");
  if (files.reduce((size, file) => size + file.size, 0) > 24 * 1024 * 1024) throw new OpsError("Keep receipts below 24 MB in total.");
  for (const file of files) {
   const result = await uploadWorkspaceFile({ workspaceId: actor.workspace.id, uploadedById: actor.user.id, file, folder: "requests", allowedTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp"], maxBytes: 10 * 1024 * 1024 });
   if (!result.ok) throw new OpsError(result.error); receiptFileIds.push(result.file.id);
  }
  await createRequest(actor, { ...data, receiptFileIds });
 });
}
export async function decideRequest(slug: string, form: FormData) { return runAction(slug, "requests", async actor => { const r = await decide(actor, values(form)); if (!r.ok) throw new OpsError(r.error); }); }
export async function finishMoneyRequest(slug: string, form: FormData) { return runAction(slug, "requests", async actor => { const v = parse(z.object({ kind: z.enum(["purchase_request", "reimbursement"]), id: z.string().min(1).max(64) }), values(form)); await completeRequest(actor, v.kind, v.id); }, true); }
export async function saveBudget(slug: string, form: FormData) { return runAction(slug, "requests", async actor => { await createBudget(actor, { ...values(form), amountMinor: money(form) }); }, true); }
export async function saveApprovalPolicy(slug: string, form: FormData) { return runAction(slug, "requests", async actor => { await savePolicy(actor, { ...values(form), steps: json(form, "steps") }); }, true); }
export async function changeMoneyRequest(slug: string, form: FormData) { return runAction(slug, "requests", async actor => { const v = parse(z.object({ kind: z.enum(["purchase_request", "reimbursement"]), id: z.string().min(1).max(64), operation: z.enum(["withdraw", "resubmit"]) }), values(form)); await (v.operation === "withdraw" ? withdrawRequest : resubmitRequest)(actor, v.kind, v.id); }); }

export async function reviseMoneyRequest(slug: string, form: FormData) {
 return runAction(slug, "requests", async actor => {
  const v = parse(z.object({ kind: z.enum(["purchase_request", "reimbursement"]), id: z.string().min(1).max(64) }), values(form));
  await resubmitRequest(actor, v.kind, v.id, { ...values(form), totalMinor: money(form) });
 });
}
export async function submitGenericRequest(slug: string, form: FormData) {
 return runAction(slug, "requests", async actor => { await createGenericRequest(actor, values(form)); });
}

export async function addApprovalComment(slug: string, form: FormData) {
 return runAction(slug, "requests", async actor => { const result = await commentOnApproval(actor, values(form)); if (!result.ok) throw new OpsError(result.error); });
}
