"use server";
import { runAction, dateInstant, values, money, list } from "@/lib/approvals/action";
import { saveService } from "@/lib/catalogue/service";
export async function saveCatalogueService(slug: string, form: FormData) { return runAction(slug, "catalogue", async a => { await saveService(a, { ...values(form), renewalAt: dateInstant(form, "renewalAt", a.workspace.timezone), costMinor: form.get("amount") ? money(form) : undefined, costCurrency: String(form.get("currency") || "INR"), costPeriod: form.get("costPeriod") || undefined, monitorIds: list(form, "monitorIds"), cloudResourceIds: list(form, "cloudResourceIds"), vaultItemIds: list(form, "vaultItemIds") }); }); }
