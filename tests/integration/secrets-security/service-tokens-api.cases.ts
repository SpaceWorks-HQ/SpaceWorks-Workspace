import { it, expect } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  changeSecrets,
  readSecrets,
} from "@/lib/secrets/service";
import {
  createServiceToken,
  authenticateServiceToken,
  revokeServiceToken,
  ipAllowed,
} from "@/lib/secrets/tokens";
import { GET, POST } from "@/app/api/v1/secrets/route";
import { owner, admin, project } from "./fixtures";

export function registerServiceTokenApiTests() {
  it("enforces service token scope, expiry, exact path, IP rules, revocation and creator membership", async () => {
    const p = await project();
    await changeSecrets(owner, p.dev.id, [
      { key: "TOKEN", path: "/api", value: "service-only" },
      { key: "ROOT", path: "/", value: "root" },
    ]);
    const raw = await createServiceToken(owner, p.dev.id, {
      name: "Deploy",
      path: "/api",
      ipAllowlist: ["192.0.2.0/24"],
      expiresAt: new Date(Date.now() + 60000),
    });
    expect(await authenticateServiceToken(raw, "198.51.100.1")).toBeNull();
    const actor = (await authenticateServiceToken(raw, "192.0.2.9"))!;
    expect(
      await readSecrets(actor, p.dev.id, "/api", { exporting: true }),
    ).toEqual({ TOKEN: "service-only" });
    await expect(readSecrets(actor, p.dev.id, "/")).rejects.toThrow("folder");
    await expect(readSecrets(actor, p.staging.id, "/api")).rejects.toThrow();
    await expect(
      changeSecrets(actor, p.dev.id, [
        { key: "TOKEN", path: "/api", value: "no" },
      ]),
    ).rejects.toThrow();
    expect(await authenticateServiceToken(raw + "x", "192.0.2.9")).toBeNull();
    expect(
      await authenticateServiceToken(
        raw,
        "192.0.2.9",
        new Date(Date.now() + 61000),
      ),
    ).toBeNull();
    await revokeServiceToken(owner, p.dev.id, actor.machine!.id);
    expect(await authenticateServiceToken(raw, "192.0.2.9")).toBeNull();
    const writable = await createServiceToken(owner, p.dev.id, {
      name: "CI",
      path: "/",
      writable: true,
    });
    const writer = (await authenticateServiceToken(writable, "unknown"))!;
    await changeSecrets(writer, p.dev.id, [
      { key: "ROOT", path: "/", value: "changed" },
    ]);
    const adminToken = await createServiceToken(admin, p.dev.id, {
      name: "Admin runner",
      path: "/",
    });
    await prisma.membership.update({
      where: {
        userId_workspaceId: {
          userId: admin.user.id,
          workspaceId: admin.workspace.id,
        },
      },
      data: { status: "SUSPENDED" },
    });
    try {
      expect(await authenticateServiceToken(adminToken, "unknown")).toBeNull();
    } finally {
      await prisma.membership.update({
        where: {
          userId_workspaceId: {
            userId: admin.user.id,
            workspaceId: admin.workspace.id,
          },
        },
        data: { status: "ACTIVE" },
      });
    }
    expect(ipAllowed("2001:db8::12", ["2001:db8::/32"])).toBe(true);
    expect(ipAllowed("unknown", ["192.0.2.1"])).toBe(false);
    expect(ipAllowed("192.0.2.1", ["0.0.0.0/99"])).toBe(false);
  });
  it("exposes the scoped REST API to machines, never generic assistant tokens", async () => {
    const p = await project();
    await changeSecrets(owner, p.dev.id, [
      { key: "CLI_KEY", path: "/", value: "cli-test" },
    ]);
    const raw = await createServiceToken(owner, p.dev.id, {
      name: "Deploy",
      path: "/",
    });
    const url = `http://localhost:3100/api/v1/secrets?project=${p.id}&environment=dev&path=/&format=json`;
    const response = await GET(
      new NextRequest(url, { headers: { authorization: `Bearer ${raw}` } }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ CLI_KEY: "cli-test" });
    expect(
      (
        await GET(
          new NextRequest(url, {
            headers: { authorization: "Bearer sww_generic_assistant_token" },
          }),
        )
      ).status,
    ).toBe(403);
    const write = await POST(
      new NextRequest(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${raw}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          project: p.id,
          environment: "dev",
          changes: [{ key: "NO", path: "/", value: "no" }],
        }),
      }),
    );
    expect(write.status).toBe(403);
  });
}
