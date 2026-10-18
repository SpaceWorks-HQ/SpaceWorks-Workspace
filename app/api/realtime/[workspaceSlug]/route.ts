import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { findWorkspaceForUser } from "@/lib/permissions";
import { checkRateLimitById } from "@/lib/rateLimit";
import { isEventVisibleTo, subscribe, type RealtimeEvent } from "@/lib/realtime";

export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;
/** Reconnect periodically so a suspended or removed member loses access within this window. */
const MAX_CONNECTION_MS = 10 * 60_000;

function notFound() {
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}

/**
 * Server-Sent Events for one workspace. Members only: unknown workspaces and
 * non-members get the same 404. Events are filtered per user (audience and
 * `user:` channels) and carry ids only.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/realtime/[workspaceSlug]">) {
  const { workspaceSlug } = await ctx.params;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return notFound();
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { disabledAt: true } });
  if (!user || user.disabledAt) return notFound();
  const access = await findWorkspaceForUser(workspaceSlug, userId);
  if (!access) return notFound();
  if (!(await checkRateLimitById("realtime", `user:${userId}`))) {
    return new Response("Too many requests", { status: 429, headers: { "Retry-After": "30", "Cache-Control": "no-store" } });
  }

  const encoder = new TextEncoder();
  let cleanup: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          close();
        }
      };
      const unsubscribe = await subscribe(access.workspace.id, (event: RealtimeEvent) => {
        if (isEventVisibleTo(event, userId)) send(`event: message\ndata: ${JSON.stringify(event)}\n\n`);
      });
      const heartbeat = setInterval(() => send(`: ping\n\n`), HEARTBEAT_MS);
      const lifetime = setTimeout(() => close(), MAX_CONNECTION_MS);
      function close() {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(lifetime);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed by the client.
        }
      }
      cleanup = close;
      request.signal.addEventListener("abort", close);
      send(`retry: 5000\nevent: ready\ndata: {}\n\n`);
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
