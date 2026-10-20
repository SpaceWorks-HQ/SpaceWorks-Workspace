import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NAV_GROUPS, navForMember } from "@/lib/nav";

function routeExists(path: string): boolean {
  if (existsSync(join(path, "page.tsx"))) return true;
  return existsSync(path) && readdirSync(path, { withFileTypes: true }).some(entry => entry.isDirectory() && entry.name.startsWith("(") && routeExists(join(path, entry.name)));
}
describe("completed area navigation", () => {
  it("resolves every configured entry to a built page", () => {
    for (const item of NAV_GROUPS.flatMap(group => group.items)) {
      expect(routeExists(join(process.cwd(), "app/w/[workspaceSlug]", item.path.split("#")[0]!)), item.key).toBe(true);
    }
  });
  it("covers the completed collaboration, relationship, personal and settings routes", () => {
    const context = { role: "OWNER" as const, workspace: { financeVisibleToMembers: false } };
    const keys = navForMember("makers", context).flatMap(g => g.items.map(i => i.key));
    expect(keys).toEqual(expect.arrayContaining(["app-reviews", "organisations", "pipeline", "my-onboarding", "decisions", "templates", "changelog", "sign-offs", "links", "activity", "search", "notification-preferences", "retention", "webhooks", "app-reviews-settings"]));
    const guests = navForMember("makers", { ...context, role: "GUEST" }).flatMap(g => g.items.map(i => i.key));
    for (const key of ["app-reviews", "organisations", "pipeline", "services", "vault", "retention", "webhooks", "app-reviews-settings"]) expect(guests).not.toContain(key);
  });
});
