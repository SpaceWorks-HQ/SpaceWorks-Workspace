import { expect, it } from "vitest";
import { mutateTemplate } from "@/lib/templates/service";
import { owner, outsider, projectId } from "./fixtures";

export function registerTemplateApplicationTests() {
  it("applies document, project and task templates through their owning services", async () => {
    for (const kind of ["DOC", "PROJECT", "TASK"] as const) {
      const t = await mutateTemplate(owner, {
        op: "create",
        kind,
        name: `${kind} starter`,
        title: "Community repair",
        text: "Build with {{workspace}}",
      });
      const applied = await mutateTemplate(owner, {
        op: "apply",
        templateId: t.id,
        key: "REPAIR",
        projectId,
        requestId: kind,
      });
      const again = await mutateTemplate(owner, {
        op: "apply",
        templateId: t.id,
        key: "REPAIR",
        projectId,
        requestId: kind,
      });
      expect(again.id).toBe(applied.id);
      await expect(
        mutateTemplate(outsider, {
          op: "apply",
          templateId: t.id,
          requestId: "foreign",
        }),
      ).rejects.toThrow();
    }
  });
}
