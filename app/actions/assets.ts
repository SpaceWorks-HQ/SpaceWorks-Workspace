"use server";
import { zonedInputToIso } from "@/lib/timeZone";
import { OpsError } from "@/lib/approvals/ops";
import { runAction, values } from "@/lib/approvals/action";
import { saveAsset, bookAsset, checkoutAsset, returnAsset, cancelBooking, logMaintenance, saveKey } from "@/lib/assets/service";
export async function saveInventory(slug: string, form: FormData) { return runAction(slug, "assets", async a => { await saveAsset(a, { ...values(form), bookable: form.get("bookable") === "on", checkoutable: form.get("checkoutable") === "on" }); }, true); }
export async function bookEquipment(slug: string, form: FormData) { return runAction(slug, "assets", async a => { const startsAt = zonedInputToIso(String(form.get("startsAt")), a.workspace.timezone); const endsAt = zonedInputToIso(String(form.get("endsAt")), a.workspace.timezone); if (!startsAt || !endsAt) throw new OpsError("Choose valid start and end times in the workspace time zone."); await bookAsset(a, { ...values(form), startsAt, endsAt }); }); }
export async function borrowEquipment(slug: string, form: FormData) { return runAction(slug, "assets", async a => { const dueAt = zonedInputToIso(`${String(form.get("dueAt"))}T23:59`, a.workspace.timezone); if (!dueAt) throw new OpsError("Choose a valid return date."); await checkoutAsset(a, { ...values(form), dueAt }); }); }
export async function returnEquipment(slug: string, form: FormData) { return runAction(slug, "assets", async a => { await returnAsset(a, values(form)); }); }
export async function cancelEquipmentBooking(slug: string, form: FormData) { return runAction(slug, "assets", async a => { await cancelBooking(a, String(form.get("bookingId"))); }); }
export async function addMaintenance(slug: string, form: FormData) { return runAction(slug, "assets", async a => { await logMaintenance(a, values(form)); }, true); }
export async function savePhysicalKey(slug: string, form: FormData) { return runAction(slug, "assets", async a => { await saveKey(a, values(form)); }, true); }
