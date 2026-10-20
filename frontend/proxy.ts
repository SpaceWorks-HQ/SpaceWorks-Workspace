// Web APIs only: Netlify can execute this proxy in its edge runtime.
import { NextResponse, type NextRequest } from "next/server";
import { pageSecurity } from "@/lib/pageSecurity";

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const bucket = request.method === "POST" && request.headers.has("next-action") ? "action" : path === "/discover" || path === "/search" ? "search" : null;
  if (bucket) {
    const origin = process.env.BACKEND_ORIGIN;
    const key = process.env.FRONTEND_GATEWAY_SECRET;
    const canonical = process.env.NEXT_PUBLIC_BASE_URL;
    const configured = process.env.FRONTEND_TRUSTED_IP_HEADER;
    const value = configured === "x-nf-client-connection-ip" || configured === "x-real-ip" ? request.headers.get(configured)?.trim() : null;
    try {
      if (!origin || !key || !canonical) throw new Error();
      const response = await fetch(`${origin}/api/frontend/guard/${bucket}`, {
        method: "POST", headers: { "x-sww-frontend-key": key, "x-sww-frontend-client-ip": value && value.length < 64 ? value : "unknown", Origin: canonical },
        redirect: "manual", signal: AbortSignal.timeout(10_000),
      });
      await response.body?.cancel();
      if (response.status !== 204) return NextResponse.json({ error: "Too many requests. Try again later." }, { status: response.status === 429 ? 429 : 503, headers: { "Cache-Control": "no-store", "Retry-After": "60" } });
    } catch {
      return NextResponse.json({ error: "The server could not be reached. Try again shortly." }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
  }
  if (path.startsWith("/api/")) {
    const response = NextResponse.next();
    response.headers.set("X-Frame-Options", "DENY");
    return response;
  }
  return pageSecurity(request);
}

export const config = {
  matcher: ["/api/:path*", "/search", { source: "/((?!api|_next/static|_next/image|favicon.ico).*)", missing: [{ type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }] }],
};
