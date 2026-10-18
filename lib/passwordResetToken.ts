import { sha256Hex } from "@/lib/crypto";

export const PASSWORD_RESET_TTL_MS = 60 * 60_000;

export function hashPasswordResetToken(token: string) {
  return sha256Hex(`password-reset:${token}`);
}

export function isPlausibleResetToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}
