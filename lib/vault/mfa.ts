import "server-only";
import { hmacHex, safeEqual } from "@/lib/crypto";
import { prisma, type DbClient } from "@/lib/db";
import { consumeMfaCode, decryptMfaSecret } from "@/lib/mfa";
import { OpsError } from "@/lib/approvals/ops";
export const VAULT_MFA_COOKIE = "sww.vault-step.v1";
export const MFA_WINDOW_MS = 5 * 60_000;
function signature(body: string) {
 const key = process.env.AUTH_SECRET;
 if (!key || key.length < 32) throw new OpsError("Vault verification is unavailable. Contact an admin.");
 return hmacHex(key, `vault-step:${body}`);
}
export async function verifyVaultMfa(userId: string, code: string, now = new Date()) {
 const user = await prisma.user.findUnique({ where: { id: userId } });
 if (!user?.mfaEnabledAt || !user.mfaSecretEncrypted || user.disabledAt) throw new OpsError("Enable two-step verification in your account first.");
 if (!await consumeMfaCode(decryptMfaSecret(user.mfaSecretEncrypted), user.email, code)) throw new OpsError("That code is invalid or already used. Try the next code.");
 const body = Buffer.from(JSON.stringify({ u: userId, v: user.sessionVersion, m: user.mfaEnabledAt.getTime(), at: now.getTime() })).toString("base64url");
 return `${body}.${signature(body)}`;
}
export async function hasVaultMfa(userId: string, proof: string | undefined, now = new Date(), client: DbClient = prisma) {
 if (!proof || proof.length > 1000) return false;
 try {
  const [body, sig, extra] = proof.split(".");
  if (!body || !sig || extra || !safeEqual(signature(body), sig)) return false;
  const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (parsed.u !== userId || !Number.isSafeInteger(parsed.at) || parsed.at > now.getTime() || now.getTime() - parsed.at >= MFA_WINDOW_MS) return false;
  const user = await client.user.findUnique({ where: { id: userId }, select: { sessionVersion: true, mfaEnabledAt: true, disabledAt: true } });
  return !!user?.mfaEnabledAt && !user.disabledAt && parsed.v === user.sessionVersion && parsed.m === user.mfaEnabledAt.getTime();
 } catch { return false; }
}
