import { expect, it } from "vitest";
import { loadControlsView } from "@/lib/moneyControls/queries";
import { saveMoneyControlAction } from "@/app/actions/money-controls";
import { GET as exportRoute } from "@/app/w/[workspaceSlug]/money-controls/export/[section]/route";
import { session, actor, guest, other, save, attach } from "./fixtures";

export function registerActionsQueriesTests() {
  it("guards actions and exports with current session and tenant permissions", async () => {
    const form = new FormData();
    form.set("kind", "FLOAT");
    session.id = guest.user.id;
    expect((await saveMoneyControlAction(actor.workspace.slug, form)).ok).toBe(
      false,
    );
    const context = {
      params: Promise.resolve({
        workspaceSlug: actor.workspace.slug,
        section: "cash",
      }),
    };
    session.id = other.user.id;
    expect(
      (await exportRoute(new Request("http://localhost/export"), context))
        .status,
    ).toBe(404);
    session.id = actor.user.id;
    const result = await exportRoute(
      new Request("http://localhost/export"),
      context,
    );
    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toContain("no-store");
    expect(await result.text()).toContain("File references");
  });
  it("loads a selected record with its proof even outside the current filters", async () => {
    const id = await save("FILING", {
      occurredOn: "2025-06-10",
      details: { fiscalYear: 2025, quarter: "Q1", form: "Prior-year return" },
    });
    await attach(id);
    const view = await loadControlsView(
      actor,
      "tds",
      { fiscalYear: 2026, q: "no matching title", quarter: "Q4" },
      id,
    );
    expect(view.data.rows.find((r) => r.id === id)?.files).toHaveLength(1);
    expect(view.editing?.id).toBe(id);
  });
}
