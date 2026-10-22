import "server-only";
import type { Section } from "../types";
import type { Definition } from "./types";

export function createRegistry() {
  const defs: Definition[] = [];
  function add(
    id: string,
    section: Section,
    title: string,
    description: string,
    data: Omit<
      Definition,
      "id" | "section" | "title" | "description" | "unit" | "chart" | "mode"
    > &
      Partial<Pick<Definition, "unit" | "chart" | "mode">>,
  ) {
    defs.push({
      id,
      section,
      title,
      description,
      unit: "count",
      chart: "bar",
      mode: "sum",
      ...data,
    });
  }
  return { defs, add };
}
export type DefinitionRegistry = ReturnType<typeof createRegistry>;
