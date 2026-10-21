import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { randomToken, sha256Hex, safeEqual } from "@/lib/crypto";
import { hasVaultMfa } from "@/lib/vault/mfa";
import { recordAuditEvent } from "@/lib/audit";
import { SecretsError } from "./values";
const ACCESS_MS = 15 * 60000,
  REFRESH_MS = 30 * 86400000;
export async function issueDeviceCode(input: unknown, now = new Date()) {
  const p = z
    .object({ deviceName: z.string().trim().min(1).max(100) })
    .safeParse(input);
  if (!p.success) throw new SecretsError("Enter a device name.");
  const deviceCode = randomToken();
  const userCode = randomToken(6)
    .toUpperCase()
    .replace(/[-_]/g, "X")
    .slice(0, 8);
  await prisma.cliDeviceCode.create({
    data: {
      deviceHash: sha256Hex(deviceCode),
      userCodeHash: sha256Hex(userCode),
      deviceName: p.data.deviceName,
      expiresAt: new Date(now.getTime() + 600000),
    },
  });
  return {
    device_code: deviceCode,
    user_code: userCode,
    expires_in: 600,
    interval: 5,
  };
}
export async function inspectDeviceCode(userCode: string, now = new Date()) {
  if (!/^[A-Z0-9]{8}$/.test(userCode)) return null;
  return prisma.cliDeviceCode.findFirst({
    where: {
      userCodeHash: sha256Hex(userCode),
      status: "PENDING",
      expiresAt: { gt: now },
    },
    select: { deviceName: true, scope: true, expiresAt: true },
  });
}
export async function approveDeviceCode(
  userId: string,
  userCode: string,
  approve: boolean,
  proof?: string,
  now = new Date(),
) {
  if (!/^[A-Z0-9]{8}$/.test(userCode))
    throw new SecretsError(
      "That device code is unavailable. Start login again.",
    );
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findFirst({
      where: { id: userId, disabledAt: null },
      select: { id: true, sessionVersion: true, mfaEnabledAt: true },
    });
    if (!user) throw new SecretsError("Sign in again.");
    const verified =
      !!user.mfaEnabledAt && (await hasVaultMfa(userId, proof, now, tx));
    if (approve && user.mfaEnabledAt && !verified)
      throw new SecretsError(
        "Verify a fresh two-step code before approving this device.",
      );
    const changed = await tx.cliDeviceCode.updateMany({
      where: {
        userCodeHash: sha256Hex(userCode),
        status: "PENDING",
        expiresAt: { gt: now },
      },
      data: {
        status: approve ? "APPROVED" : "DENIED",
        userId,
        sessionVersion: user.sessionVersion,
        mfaAt: verified ? now : null,
      },
    });
    if (!changed.count)
      throw new SecretsError(
        "That device code is unavailable. Start login again.",
      );
    await recordAuditEvent({
      client: tx,
      actorId: userId,
      action: approve ? "secrets.device_approved" : "secrets.device_denied",
      targetType: "CliDeviceCode",
    });
  });
}
export async function pollDeviceCode(deviceCode: string, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(deviceCode))
    return { error: "invalid_grant" };
  return prisma.$transaction(async (tx) => {
    const hash = sha256Hex(deviceCode);
    await tx.$queryRaw`SELECT "id" FROM "CliDeviceCode" WHERE "deviceHash"=${hash} FOR UPDATE`;
    const device = await tx.cliDeviceCode.findUnique({
      where: { deviceHash: hash },
    });
    if (
      !device ||
      !safeEqual(device.deviceHash, hash) ||
      device.status === "CONSUMED"
    )
      return { error: "invalid_grant" };
    if (device.expiresAt <= now) return { error: "expired_token" };
    if (
      device.lastPolledAt &&
      now.getTime() - device.lastPolledAt.getTime() < 5000
    )
      return { error: "slow_down" };
    await tx.cliDeviceCode.update({
      where: { id: device.id },
      data: { lastPolledAt: now },
    });
    if (device.status === "DENIED") return { error: "access_denied" };
    if (device.status !== "APPROVED" || !device.userId)
      return { error: "authorization_pending" };
    const user = await tx.user.findFirst({
      where: {
        id: device.userId,
        disabledAt: null,
        sessionVersion: device.sessionVersion ?? -1,
      },
    });
    if (!user) return { error: "invalid_grant" };
    const access = randomToken(),
      refresh = randomToken();
    await tx.cliSession.create({
      data: {
        userId: user.id,
        name: device.deviceName,
        accessHash: sha256Hex(access),
        refreshHash: sha256Hex(refresh),
        accessExpiresAt: new Date(now.getTime() + ACCESS_MS),
        refreshExpiresAt: new Date(now.getTime() + REFRESH_MS),
        sessionVersion: user.sessionVersion,
        mfaAt: device.mfaAt,
      },
    });
    await tx.cliDeviceCode.update({
      where: { id: device.id },
      data: { status: "CONSUMED" },
    });
    await recordAuditEvent({
      client: tx,
      actorId: user.id,
      action: "secrets.cli_login",
    });
    return {
      access_token: access,
      refresh_token: refresh,
      token_type: "Bearer",
      expires_in: ACCESS_MS / 1000,
    };
  });
}
export async function authenticateCliToken(raw: string, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(raw)) return null;
  const row = await prisma.cliSession.findUnique({
    where: { accessHash: sha256Hex(raw) },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          disabledAt: true,
          sessionVersion: true,
          mfaEnabledAt: true,
        },
      },
    },
  });
  if (
    !row ||
    !safeEqual(row.accessHash, sha256Hex(raw)) ||
    row.revokedAt ||
    row.accessExpiresAt <= now ||
    row.refreshExpiresAt <= now ||
    row.user.disabledAt ||
    row.sessionVersion !== row.user.sessionVersion
  )
    return null;
  await prisma.cliSession.update({
    where: { id: row.id },
    data: { lastUsedAt: now },
  });
  return row;
}
export async function refreshCliToken(raw: string, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(raw))
    throw new SecretsError("Sign in again.");
  return prisma.$transaction(async (tx) => {
    const hash = sha256Hex(raw);
    await tx.$queryRaw`SELECT "id" FROM "CliSession" WHERE "refreshHash"=${hash} FOR UPDATE`;
    const row = await tx.cliSession.findUnique({
      where: { refreshHash: hash },
      include: { user: { select: { disabledAt: true, sessionVersion: true } } },
    });
    if (
      !row ||
      !safeEqual(row.refreshHash, hash) ||
      row.revokedAt ||
      row.refreshExpiresAt <= now ||
      row.user.disabledAt ||
      row.sessionVersion !== row.user.sessionVersion
    )
      throw new SecretsError("Sign in again.");
    const access = randomToken(),
      refresh = randomToken();
    await tx.cliSession.update({
      where: { id: row.id },
      data: {
        accessHash: sha256Hex(access),
        refreshHash: sha256Hex(refresh),
        accessExpiresAt: new Date(now.getTime() + ACCESS_MS),
      },
    });
    await recordAuditEvent({
      client: tx,
      actorId: row.userId,
      action: "secrets.cli_refreshed",
      targetId: row.id,
    });
    return {
      access_token: access,
      refresh_token: refresh,
      expires_in: ACCESS_MS / 1000,
    };
  });
}
export async function listCliSessions(userId: string) {
  return prisma.cliSession.findMany({
    where: { userId, revokedAt: null },
    select: {
      id: true,
      name: true,
      lastUsedAt: true,
      createdAt: true,
      refreshExpiresAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}
export async function revokeCliSession(userId: string, id: string) {
  await prisma.$transaction(async (tx) => {
    const revoked = await tx.cliSession.updateMany({
      where: { id, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count)
      await recordAuditEvent({
        client: tx,
        actorId: userId,
        action: "secrets.cli_revoked",
        targetId: id,
      });
  });
}
