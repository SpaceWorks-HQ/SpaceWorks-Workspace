import { it, expect } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  saveGrant,
  changeSecrets,
} from "@/lib/secrets/service";
import {
  issueDeviceCode,
  approveDeviceCode,
  pollDeviceCode,
  authenticateCliToken,
  refreshCliToken,
  revokeCliSession,
} from "@/lib/secrets/device";
import { GET, POST } from "@/app/api/v1/secrets/route";
import { owner, member, project, proof } from "./fixtures";

export function registerCliDeviceSessionTests() {
  it("applies user CLI environment permissions and revocation to the read/write API", async () => {
    const p = await project();
    await changeSecrets(owner, p.dev.id, [
      { key: "USER_CLI", path: "/", value: "user-scoped" },
    ]);
    const device = await issueDeviceCode({ deviceName: "Scope test" });
    await approveDeviceCode(member.user.id, device.user_code, true);
    const issued = await pollDeviceCode(device.device_code);
    if (!("access_token" in issued)) throw new Error("Token issuance failed");
    const raw = issued.access_token!;
    const url = `http://localhost:3100/api/v1/secrets?project=${p.id}&environment=dev&path=/&key=USER_CLI`;
    const request = () =>
      new NextRequest(url, { headers: { authorization: `Bearer ${raw}` } });
    expect((await GET(request())).status).toBe(403);
    await saveGrant(owner, {
      projectId: p.id,
      environmentId: p.dev.id,
      userId: member.user.id,
      role: "READ",
    });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ USER_CLI: "user-scoped" });
    const write = () =>
      new NextRequest(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${raw}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          project: p.id,
          environment: "dev",
          changes: [{ key: "USER_CLI", path: "/", value: "written" }],
        }),
      });
    expect((await POST(write())).status).toBe(403);
    await saveGrant(owner, {
      projectId: p.id,
      environmentId: p.dev.id,
      userId: member.user.id,
      role: "WRITE",
    });
    expect((await POST(write())).status).toBe(200);
    expect(
      await authenticateCliToken(raw, new Date(Date.now() + 901000)),
    ).toBeNull();
    const session = (await authenticateCliToken(raw))!;
    await revokeCliSession(member.user.id, session.id);
    expect((await GET(request())).status).toBe(403);
  });

  it("approves, polls once, hashes tokens, refreshes atomically and revokes", async () => {
    const now = new Date(),
      device = await issueDeviceCode({ deviceName: "Test terminal" }, now);
    expect((await pollDeviceCode(device.device_code, now)).error).toBe(
      "authorization_pending",
    );
    expect(
      (await pollDeviceCode(device.device_code, new Date(now.getTime() + 1000)))
        .error,
    ).toBe("slow_down");
    await approveDeviceCode(
      member.user.id,
      device.user_code,
      true,
      undefined,
      now,
    );
    const result = await pollDeviceCode(
      device.device_code,
      new Date(now.getTime() + 5100),
    );
    if (!("access_token" in result)) throw new Error("Token issuance failed");
    const session = await authenticateCliToken(result.access_token!);
    expect(session?.userId).toBe(member.user.id);
    const row = await prisma.cliSession.findUniqueOrThrow({
      where: { id: session!.id },
    });
    expect(JSON.stringify(row)).not.toContain(result.access_token);
    expect(JSON.stringify(row)).not.toContain(result.refresh_token);
    expect(
      (
        await pollDeviceCode(
          device.device_code,
          new Date(now.getTime() + 11000),
        )
      ).error,
    ).toBe("invalid_grant");
    const refreshed = await refreshCliToken(result.refresh_token!);
    expect(await authenticateCliToken(result.access_token!)).toBeNull();
    await expect(refreshCliToken(result.refresh_token!)).rejects.toThrow(
      "Sign in",
    );
    await revokeCliSession(member.user.id, session!.id);
    expect(await authenticateCliToken(refreshed.access_token)).toBeNull();
    await expect(refreshCliToken(refreshed.refresh_token)).rejects.toThrow(
      "Sign in",
    );
  });
  it("handles denied, expired, unknown and concurrent poll requests", async () => {
    const now = new Date(),
      denied = await issueDeviceCode({ deviceName: "Denied" }, now);
    await approveDeviceCode(
      member.user.id,
      denied.user_code,
      false,
      undefined,
      now,
    );
    expect((await pollDeviceCode(denied.device_code, now)).error).toBe(
      "access_denied",
    );
    const expired = await issueDeviceCode({ deviceName: "Expired" }, now);
    expect(
      (
        await pollDeviceCode(
          expired.device_code,
          new Date(now.getTime() + 601000),
        )
      ).error,
    ).toBe("expired_token");
    expect((await pollDeviceCode("invalid", now)).error).toBe("invalid_grant");
    const concurrent = await issueDeviceCode({ deviceName: "Concurrent" }, now);
    await approveDeviceCode(
      member.user.id,
      concurrent.user_code,
      true,
      undefined,
      now,
    );
    const responses = await Promise.all([
      pollDeviceCode(concurrent.device_code, now),
      pollDeviceCode(concurrent.device_code, now),
    ]);
    expect(responses.filter((r) => "access_token" in r)).toHaveLength(1);
  });
  it("requires enabled members' fresh MFA, invalidates sessions with account version, and never permits revoking another user's session", async () => {
    const device = await issueDeviceCode({ deviceName: "MFA terminal" });
    await expect(
      approveDeviceCode(owner.user.id, device.user_code, true),
    ).rejects.toThrow("two-step");
    const fresh = await proof(owner);
    await approveDeviceCode(owner.user.id, device.user_code, true, fresh);
    const result = await pollDeviceCode(device.device_code);
    if (!("access_token" in result)) throw new Error("Token issuance failed");
    const session = (await authenticateCliToken(result.access_token!))!;
    await revokeCliSession(member.user.id, session.id);
    expect(await authenticateCliToken(result.access_token!)).not.toBeNull();
    await prisma.user.update({
      where: { id: owner.user.id },
      data: { sessionVersion: { increment: 1 } },
    });
    expect(await authenticateCliToken(result.access_token!)).toBeNull();
  });
}
