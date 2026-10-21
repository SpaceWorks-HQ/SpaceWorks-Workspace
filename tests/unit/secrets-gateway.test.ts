import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/frontend/config", () => ({
  backendOrigin: () => "http://127.0.0.1:3101",
  frontendOrigin: () => "https://workspace.example.org",
}));
vi.mock("@/lib/frontend/request", () => ({
  backendHeaders: async () =>
    new Headers({
      cookie: "session=browser-authority",
      origin: "https://workspace.example.org",
    }),
  backendUrl: (path: string) => new URL(path, "http://127.0.0.1:3101"),
}));
import { proxyBackendApi } from "@/lib/frontend/httpProxy";
afterEach(() => vi.unstubAllGlobals());
describe("Secrets CLI gateway authority", () => {
  it("allows CLI device requests without browser Origin and strips browser cookies", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const response = await proxyBackendApi(
      new Request("https://workspace.example.org/api/cli/device/code", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "session=browser-authority",
        },
        body: JSON.stringify({ deviceName: "terminal" }),
      }),
    );
    expect(response.status).toBe(200);
    const outgoing = fetcher.mock.calls[0][1].headers as Headers;
    expect(outgoing.has("cookie")).toBe(false);
  });
  it("forwards universal authentication without browser authority", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 200 })); vi.stubGlobal("fetch", fetcher);
    const response = await proxyBackendApi(new Request("https://workspace.example.org/api/v1/auth/universal/login", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    expect(response.status).toBe(200); expect(fetcher.mock.calls[0][1].headers.has("cookie")).toBe(false);
  });
  it("retains the same-origin gate for browser reveal and share requests", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    for (const path of ["/api/w/demo/secrets", "/api/secrets/share"]) {
      const response = await proxyBackendApi(
        new Request("https://workspace.example.org" + path, {
          method: "POST",
          headers: {
            origin: "https://another.example.org",
            "content-type": "application/json",
          },
          body: "{}",
        }),
      );
      expect(response.status).toBe(404);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});
