import { proxyBackendApi } from "@/lib/frontend/httpProxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = proxyBackendApi;
export const HEAD = proxyBackendApi;
export const POST = proxyBackendApi;
export const PUT = proxyBackendApi;
export const PATCH = proxyBackendApi;
export const DELETE = proxyBackendApi;
export const OPTIONS = proxyBackendApi;
