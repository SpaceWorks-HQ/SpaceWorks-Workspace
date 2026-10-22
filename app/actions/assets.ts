"use server";
import { runAction, values } from "@/lib/approvals/action";
import { saveAsset, logMaintenance, saveKey } from "@/lib/assets/service";
export async function saveInventory(slug: string, form: FormData) { return runAction(slug, "assets", async a => { await saveAsset(a, values(form)); }, true); }
export async function addMaintenance(slug: string, form: FormData) { return runAction(slug, "assets", async a => { await logMaintenance(a, values(form)); }, true); }
export async function savePhysicalKey(slug: string, form: FormData) { return runAction(slug, "assets", async a => { await saveKey(a, values(form)); }, true); }
