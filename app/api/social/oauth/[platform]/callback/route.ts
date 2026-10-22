import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { PLATFORMS } from "@/lib/social/config";
import { completeSocial, consumeSocialState } from "@/lib/social/oauth";
import { integrationBaseUrl } from "@/lib/integrations/google/oauth";
import type { SocialPlatform } from "@prisma/client";
export async function GET(request: Request, context: RouteContext<"/api/social/oauth/[platform]/callback">) {
  const user = await getCurrentUser(); if (!user) return new Response("Sign in before connecting an account.", { status: 401 });
  const { platform: name } = await context.params; const platform = name.toUpperCase() as SocialPlatform;
  if (!PLATFORMS.includes(platform)) return new Response("Not found", { status: 404 });
  const params = new URL(request.url).searchParams; const state = await consumeSocialState(params.get("state") ?? "", user.id, platform);
  if (!state) return new Response("This connection expired or was already used. Start again in Social settings.", { status: 400 });
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: state.workspaceId }, select: { slug: true } });
  const target = new URL(`/w/${encodeURIComponent(workspace.slug)}/settings/social`, integrationBaseUrl()); const code = params.get("code");
  if (!code || code.length > 4096 || params.has("error")) target.searchParams.set("notice", "cancelled");
  else { try { const draftId = await completeSocial(state, platform, code); target.searchParams.set("draft", draftId); } catch { target.searchParams.set("notice", "failed"); } }
  return NextResponse.redirect(target, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
