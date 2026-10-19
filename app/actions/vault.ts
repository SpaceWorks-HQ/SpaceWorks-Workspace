"use server";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { cookies } from "next/headers";
import { runAction, values } from "@/lib/approvals/action";
import { saveItem, createCollection, grantAccess, revokeGrant, requestAccess, deleteItem } from "@/lib/vault/service";
import { verifyVaultMfa, VAULT_MFA_COOKIE } from "@/lib/vault/mfa";
import { OpsError } from "@/lib/approvals/ops";
export async function saveVaultItem(slug: string, form: FormData) { return runAction(slug, "vault", async a => { await saveItem(a, values(form)); }); }
export async function saveVaultCollection(slug: string, form: FormData) { return runAction(slug, "vault", async a => { await createCollection(a, values(form)); }, true); }
export async function saveVaultGrant(slug: string, form: FormData) { return runAction(slug, "vault", async a => { await grantAccess(a, values(form)); }); }
export async function removeVaultGrant(slug: string, form: FormData) { return runAction(slug, "vault", async a => { await revokeGrant(a, String(form.get("grantId"))); }); }
export async function askVaultAccess(slug: string, form: FormData) { return runAction(slug, "vault", async a => { await requestAccess(a, values(form)); }); }
export async function stepUpVault(slug: string, form: FormData) { return runAction(slug, "vault", async a => {
 if (await isActionRateLimited("auth", `vault-step:${a.user.id}`)) throw new OpsError("Too many verification attempts. Try again shortly.");
 const code = String(form.get("code")); if (!/^\d{6}$/.test(code)) throw new OpsError("Enter the six-digit code from your authenticator.");
 const proof = await verifyVaultMfa(a.user.id, code);
 (await cookies()).set(VAULT_MFA_COOKIE, proof, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 300 }); return "Verified for five minutes.";
 }); }

export async function archiveVaultItem(slug: string, form: FormData) { return runAction(slug, "vault", async a => { await deleteItem(a, String(form.get("itemId"))); }); }
