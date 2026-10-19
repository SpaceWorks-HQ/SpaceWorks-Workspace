"use server";
import { headers } from "next/headers";
import { runAction, dateInstant, values, json } from "@/lib/approvals/action";
import { saveForm, submitForm, closeForm, rotatePublicLink, convertToTask } from "@/lib/forms/service";
import { getClientIpFromHeaders, checkRateLimitById } from "@/lib/rateLimit";
import { OpsError } from "@/lib/approvals/ops";
import type { ActionResult } from "@/lib/actionResult";
import { sha256Hex } from "@/lib/crypto";
export async function createIntakeForm(slug: string, form: FormData) { return runAction(slug, "forms", async a => { const result = await saveForm(a, { ...values(form), closesAt: dateInstant(form, "closesAt", a.workspace.timezone, true), fields: json(form, "fields") }); return result.publicPath ?? "Form created."; }, true); }
export async function sendInternalResponse(slug: string, form: FormData) { return runAction(slug, "forms", async a => { await submitForm({ actor: a, formId: String(form.get("formId")), answers: json(form, "answers"), honeypot: String(form.get("website") ?? ""), ip: getClientIpFromHeaders(await headers()) }); return "Response received."; }); }
export async function sendPublicResponse(token: string, form: FormData): Promise<ActionResult<string>> {
 const ip = getClientIpFromHeaders(await headers());
 if (!await checkRateLimitById("apiWrite", `public-form-ip:${sha256Hex(ip)}`)) return { ok: false, error: "Too many responses. Wait before trying again." };
 try { await submitForm({ token, answers: json(form, "answers"), honeypot: String(form.get("website") ?? ""), ip }); return { ok: true, data: "Response received. Thank you." }; } catch (e) { return { ok: false, error: e instanceof OpsError ? e.message : "Couldn't send. Try again." }; }
}
export async function closeIntakeForm(slug: string, form: FormData) { return runAction(slug, "forms", async a => { await closeForm(a, String(form.get("formId"))); }, true); }
export async function newPublicFormLink(slug: string, form: FormData) { return runAction(slug, "forms", async a => rotatePublicLink(a, String(form.get("formId"))), true); }
export async function responseToTask(slug: string, form: FormData) { return runAction(slug, "forms", async a => { await convertToTask(a, String(form.get("submissionId")), String(form.get("title"))); return "Task created in My tasks."; }, true); }
