"use server";
import { runAction, dateInstant, values, money, list } from "@/lib/approvals/action";
import { saveSubscription } from "@/lib/subscriptions/service";
export async function saveSubscriptionRecord(slug: string, form: FormData) { return runAction(slug, "subscriptions", async a => { await saveSubscription(a, { ...values(form), nextRenewalAt: dateInstant(form, "nextRenewalAt", a.workspace.timezone), amountMinor: money(form), autoRenew: form.get("autoRenew") === "on", reminderOffsets: list(form, "reminderOffsets").map(Number), destinationIds: list(form, "destinationIds") }); }, true); }
