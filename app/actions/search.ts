"use server";
import { z } from "zod";
import { shellContext, searchActor } from "@/lib/shell/context";
import { searchDocuments } from "@/lib/search/query";
import { actionError, type ActionResult } from "@/lib/actionResult";
import type { SearchHit } from "@/lib/search/query";
const schema = z.object({
  query: z.string().max(200),
  type: z.string().max(40).optional(),
});
export async function searchAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<SearchHit[]>> {
  const ctx = await shellContext(slug, "GUEST", "search");
  if (!ctx)
    return actionError(
      "Search is unavailable. Sign in or try again in a minute.",
    );
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return actionError("Use a shorter search and try again.");
  try {
    return {
      ok: true,
      data: await searchDocuments(
        searchActor(ctx),
        parsed.data.query,
        parsed.data.type,
      ),
    };
  } catch {
    return actionError("Couldn't search. Try again.");
  }
}

export async function loadWorkspaceTools(slug: string) {
  const ctx = await shellContext(slug, "GUEST", "search");
  if (!ctx) return null;
  const { workspaceToolsData } = await import("@/lib/shell/tools");
  return workspaceToolsData(ctx);
}
