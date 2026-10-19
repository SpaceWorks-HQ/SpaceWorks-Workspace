import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { findWorkspaceForUser } from "@/lib/permissions";
import { checkRateLimitById } from "@/lib/rateLimit";
import { canContribute } from "@/lib/roles";
import { runChatTurn, type ChatStreamEvent } from "@/lib/assistant/chat";
import { isSameOriginJsonRequest, notFoundResponse, PRIVATE_HEADERS } from "@/lib/assistant/http";
import type { Principal } from "@/lib/assistant/principal";
import { idSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z
  .object({
    conversationId: idSchema,
    text: z.string().trim().min(1).max(8000).optional(),
    decision: z.enum(["approve", "decline"]).optional(),
  })
  .refine((body) => body.text || body.decision, "Send a message or a decision.");

/**
 * Streams one assistant turn as Server-Sent Events (`data: <json>\n\n`).
 * Members only (404 otherwise), same-origin JSON only, rate limited per user.
 * Closing the request (the Stop button) aborts the model stream.
 */
export async function POST(request: Request, ctx: RouteContext<"/w/[workspaceSlug]/assistant/chat">) {
  const { workspaceSlug } = await ctx.params;
  if (!isSameOriginJsonRequest(request)) return notFoundResponse();
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return notFoundResponse();
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, disabledAt: true } });
  if (!user || user.disabledAt) return notFoundResponse();
  const access = await findWorkspaceForUser(workspaceSlug, userId);
  if (!access || !canContribute(access.membership)) return notFoundResponse();
  if (!(await checkRateLimitById("assistant", `user:${userId}`))) {
    return Response.json({ error: "You're sending messages quickly. Wait a minute and try again." }, { status: 429, headers: PRIVATE_HEADERS });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That request wasn't valid." }, { status: 400, headers: PRIVATE_HEADERS });

  const { workspace, membership } = access;
  const principal: Principal = {
    kind: "user",
    workspace: { id: workspace.id, slug: workspace.slug, name: workspace.name, timezone: workspace.timezone, currency: workspace.currency, financeVisibleToMembers: workspace.financeVisibleToMembers },
    userId,
    userName: user.name,
    role: membership.role,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const emit = (event: ChatStreamEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          open = false;
        }
      };
      try {
        await runChatTurn({ principal, conversationId: parsed.data.conversationId, text: parsed.data.text, decision: parsed.data.decision, signal: request.signal, emit });
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          // Already closed by the client.
        }
      }
    },
  });
  return new Response(stream, { headers: { ...PRIVATE_HEADERS, "Content-Type": "text/event-stream; charset=utf-8", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}
