import "server-only";

import crypto from "crypto";
import * as OTPAuth from "otpauth";
import { prisma, type DbClient } from "@/lib/db";
import { decodeAes256Key, decryptWithKey, encryptWithKey, hmacHex } from "@/lib/crypto";

const ISSUER = "Space Works Workspace";

function encryptionKey() {
  return decodeAes256Key(process.env.MFA_ENCRYPTION_KEY, "MFA_ENCRYPTION_KEY");
}

export function encryptMfaSecret(secret: string) {
  return encryptWithKey(encryptionKey(), secret);
}

export function decryptMfaSecret(value: string) {
  return decryptWithKey(encryptionKey(), value);
}

function totp(secret: string, email: string) {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}

export function createMfaEnrollment(email: string) {
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  return { secret, uri: totp(secret, email).toString() };
}

/** Stateless check, used only while enrolling (before a seed is stored). */
export function verifyMfaCode(secret: string, email: string, input: string) {
  const token = input.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(token) && totp(secret, email).validate({ token, window: 1 }) !== null;
}

export function generateRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => {
    const value = crypto.randomBytes(6).toString("hex").toUpperCase();
    return `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8)}`;
  });
}

export function hashRecoveryCode(code: string) {
  const normalized = code.replace(/[\s-]/g, "").toUpperCase();
  return hmacHex(process.env.AUTH_SECRET ?? "", `mfa-recovery:${normalized}`);
}

/** Replace a user's recovery codes (inside the enrolment transaction). */
export async function storeRecoveryCodes(client: DbClient, userId: string, codes: string[]) {
  await client.mfaRecoveryCode.deleteMany({ where: { userId } });
  await client.mfaRecoveryCode.createMany({ data: codes.map((code) => ({ userId, codeHash: hashRecoveryCode(code) })) });
}

/** Atomically mark one unused recovery code as used. Concurrent sign-ins cannot both succeed. */
export async function consumeRecoveryCode(userId: string, code: string) {
  const result = await prisma.mfaRecoveryCode.updateMany({
    where: { userId, codeHash: hashRecoveryCode(code), usedAt: null },
    data: { usedAt: new Date() },
  });
  return result.count === 1;
}

export async function remainingRecoveryCodes(userId: string) {
  return prisma.mfaRecoveryCode.count({ where: { userId, usedAt: null } });
}

/** A database uniqueness constraint rejects TOTP replay across workers and replicas. */
export async function consumeMfaCode(secret: string, email: string, input: string) {
  const token = input.replace(/[\s-]/g, "");
  if (!/^\d{6}$/.test(token)) return false;
  const now = Date.now();
  const delta = totp(secret, email).validate({ token, window: 1, timestamp: now });
  if (delta === null) return false;
  const step = Math.floor(now / 30_000) + delta;
  // Never persist the code or seed. Bind the claim to this seed and time step.
  const digest = crypto.createHmac("sha256", encryptionKey()).update(`totp-use:${secret}:${step}`).digest("hex");
  const claimed = await prisma.verificationToken.createMany({
    data: { identifier: "mfa-replay", token: digest, expires: new Date((step + 2) * 30_000) },
    skipDuplicates: true,
  });
  return claimed.count === 1;
}
