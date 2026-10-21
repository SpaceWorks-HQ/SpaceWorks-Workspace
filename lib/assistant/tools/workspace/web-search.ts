import "server-only";

import { z } from "zod";
import { clip } from "@/lib/assistant/tools/access";
import { defineTool, ToolError } from "@/lib/assistant/tools/types";

/* ───────────── Web search (SearXNG, only when SEARXNG_URL is set) ───────────── */

export function searxngUrl(): string | null {
  const value = process.env.SEARXNG_URL?.trim();
  return value ? value.replace(/\/+$/, "") : null;
}

export const webSearch = defineTool({
  name: "sw_web_search",
  title: "Web search",
  description: "Search the public web through the workspace's SearXNG instance. Use for facts outside the workspace; cite the links you use.",
  input: z.object({ query: z.string().trim().min(1).max(200), limit: z.number().int().min(1).max(10).default(5) }),
  write: false,
  scope: null,
  minRole: "MEMBER",
  available: () => searxngUrl() !== null,
  async run(_ctx, input) {
    const base = searxngUrl();
    if (!base) throw new ToolError("Web search is not set up on this instance.", "unavailable");
    const url = `${base}/search?${new URLSearchParams({ q: input.query, format: "json", safesearch: "1" })}`;
    let payload: { results?: Array<{ title?: string; url?: string; content?: string }> };
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000), redirect: "error" });
      if (!response.ok) throw new Error(String(response.status));
      payload = (await response.json()) as typeof payload;
    } catch {
      throw new ToolError("Web search didn't answer. Try again in a moment.", "unavailable");
    }
    const results = (payload.results ?? [])
      .filter((r) => typeof r.url === "string" && /^https?:\/\//.test(r.url))
      .slice(0, input.limit)
      .map((r) => ({ title: clip(r.title ?? r.url!, 200), url: r.url!, snippet: clip(r.content ?? "", 400) }));
    return { summary: `Searched the web for “${clip(input.query, 40)}”`, data: { results } };
  },
});
