import { getEndpoint, writeEndpoint } from "@/lib/apiTokens/http";

export const dynamic = "force-dynamic";

/** GET /api/v1/tasks/{ref} (read:tasks). `ref` is "BOT-12" or "12". */
export async function GET(request: Request, ctx: RouteContext<"/api/v1/tasks/[ref]">) {
  const { ref } = await ctx.params;
  return getEndpoint(request, "sw_get_task", { ref });
}

/** PATCH /api/v1/tasks/{ref} (write:tasks). Body: { title?, status?, priority?, dueAt? }. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/v1/tasks/[ref]">) {
  const { ref } = await ctx.params;
  return writeEndpoint(request, "sw_update_task", { ref });
}
