import { frontendRequest } from "@/lib/frontend/handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ kind: string; endpoint: string; }>; }) {
  const { kind, endpoint } = await context.params;
  return frontendRequest(request, kind, endpoint);
}
