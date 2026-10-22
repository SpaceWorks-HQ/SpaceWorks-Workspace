import { describe, expect, it } from "vitest";
import { vpsAdapter, vpsHealth } from "@/lib/monitor/cloud/providers/vps";
import { providerAdapter } from "@/lib/monitor/cloud";
import { CLOUD_PROVIDER_CATALOG } from "@/lib/monitor/cloud/catalog";
import type { AdapterContext } from "@/lib/monitor/cloud/types";

const now = new Date("2026-10-20T12:00:00Z");
type Call = { url: string; method?: string; headers?: Record<string, string>; body?: string };

function context(answer: (call: Call) => unknown, credentials: Record<string, string> = { token: "fixture" }, config: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const ctx: AdapterContext = {
    now,
    credentials,
    config,
    http: {
      json: async <T,>(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
        const call = { url, ...init };
        calls.push(call);
        return { status: 200, headers: new Headers(), data: answer(call) as T };
      },
    },
  };
  return { ctx, calls };
}

describe("VPS provider health", () => {
  it("maps provider states, including the ones generic hosts don't use", () => {
    expect(vpsHealth("running")).toBe("HEALTHY");
    expect(vpsHealth("ACTIVE_HEALTHY")).toBe("HEALTHY");
    expect(vpsHealth("provisioning")).toBe("DEGRADED");
    expect(vpsHealth("offline")).toBe("STOPPED");
    expect(vpsHealth("stopped in place")).toBe("STOPPED");
    expect(vpsHealth("INIT_FAILED")).toBe("UNHEALTHY");
    expect(vpsHealth("something new")).toBe("UNKNOWN");
  });
});

describe("Contabo", () => {
  it("signs in with the API user, sends a request id, pages and maps instances", async () => {
    const { ctx, calls } = context(
      (call) =>
        call.url.includes("openid-connect/token")
          ? { access_token: "short-lived" }
          : call.url.includes("page=1")
            ? { data: [{ instanceId: 101, displayName: "Workshop VPS", status: "running", region: "EU", ipConfig: { v4: { ip: "203.0.113.5" } } }], _pagination: { totalPages: 2 } }
            : { data: [{ instanceId: 102, name: "vmi102", status: "stopped", region: "SIN" }], _pagination: { totalPages: 2 } },
      { clientId: "id", clientSecret: "secret", apiUser: "ops@example.org", apiPassword: "pw" },
    );
    const rows = await vpsAdapter("CONTABO").listResources(ctx);
    expect(rows.map((r) => [r.name, r.status, r.region])).toEqual([["Workshop VPS", "HEALTHY", "EU"], ["vmi102", "STOPPED", "SIN"]]);
    const auth = calls[0];
    expect(auth.method).toBe("POST");
    expect(auth.body).toContain("grant_type=password");
    expect(auth.body).toContain("username=ops%40example.org");
    const list = calls.find((c) => c.url.includes("/compute/instances"))!;
    expect(list.headers?.authorization).toBe("Bearer short-lived");
    expect(list.headers?.["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(rows)).not.toContain("short-lived");
  });

  it("reports a missing credential instead of calling out", async () => {
    const { ctx, calls } = context(() => ({}), { clientId: "id" });
    const result = await vpsAdapter("CONTABO").verify(ctx);
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("Linode, Vultr, Scaleway and Supabase", () => {
  it("maps Linode instances and reports balance and uninvoiced usage", async () => {
    const { ctx } = context((call) =>
      call.url.includes("/account") ? { balance: 0, balance_uninvoiced: 18.5 } : { data: [{ id: 7, label: "mesh-node", status: "offline", region: "ap-south", ipv4: ["198.51.100.7"] }], pages: 1 },
    );
    const adapter = vpsAdapter("LINODE");
    expect((await adapter.listResources(ctx))[0]).toMatchObject({ name: "mesh-node", status: "STOPPED", region: "ap-south" });
    expect(await adapter.getCosts!(ctx)).toEqual(expect.arrayContaining([expect.objectContaining({ granularity: "MTD", amount: 18.5 }), expect.objectContaining({ granularity: "BALANCE", amount: 0 })]));
  });

  it("combines Vultr's status, power and server state, and follows the cursor", async () => {
    const { ctx, calls } = context((call) =>
      call.url.includes("/account")
        ? { account: { balance: -25, pending_charges: 4.2 } }
        : call.url.includes("cursor=")
          ? { instances: [{ id: "b", label: "backup", status: "active", power_status: "stopped", server_status: "ok" }], meta: { links: { next: "" } } }
          : { instances: [{ id: "a", label: "web", status: "active", power_status: "running", server_status: "installingbooting" }], meta: { links: { next: "abc" } } },
    );
    const rows = await vpsAdapter("VULTR").listResources(ctx);
    expect(rows.map((r) => r.status)).toEqual(["DEGRADED", "STOPPED"]);
    expect(calls.some((c) => c.url.includes("cursor=abc"))).toBe(true);
    expect(await vpsAdapter("VULTR").getCosts!(ctx)).toEqual(expect.arrayContaining([expect.objectContaining({ granularity: "MTD", amount: 4.2 })]));
  });

  it("reads Scaleway servers per zone with the secret key header and refuses bad zones", async () => {
    const { ctx, calls } = context(() => ({ servers: [{ id: "s1", name: "bench-pi", state: "running", public_ip: { address: "192.0.2.4" } }] }), { secretKey: "sk" }, { zones: ["fr-par-1", "nl-ams-1"] });
    const rows = await vpsAdapter("SCALEWAY").listResources(ctx);
    expect(rows.map((r) => r.region)).toEqual(["fr-par-1", "nl-ams-1"]);
    expect(calls[0].headers?.["x-auth-token"]).toBe("sk");
    const bad = context(() => ({}), { secretKey: "sk" }, { zones: ["../../admin"] });
    expect((await vpsAdapter("SCALEWAY").verify(bad.ctx)).ok).toBe(false);
  });

  it("lists Supabase projects with their health and API URL", async () => {
    const { ctx } = context(() => [{ id: "abcd1234", name: "Members DB", status: "ACTIVE_HEALTHY", region: "ap-south-1" }, { id: "efgh", name: "Old", status: "INACTIVE" }]);
    const rows = await vpsAdapter("SUPABASE").listResources(ctx);
    expect(rows.map((r) => r.status)).toEqual(["HEALTHY", "STOPPED"]);
    expect(rows[0].url).toBe("https://abcd1234.supabase.co");
  });
});

describe("provider wiring", () => {
  it("routes every catalogued provider to an adapter", () => {
    for (const entry of CLOUD_PROVIDER_CATALOG) expect(providerAdapter(entry.provider).label).toBe(entry.label);
  });
});
