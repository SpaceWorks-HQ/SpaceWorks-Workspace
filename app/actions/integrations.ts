"use server";
import { z } from "zod";
import { revalidatePath } from "@/lib/frontend/cache";
import { prisma } from "@/lib/db";
import { integrationAccess } from "@/lib/integrations/access";
import { beginGoogle } from "@/lib/integrations/google/oauth";
import { listCalendars, listCalendarEvents, listGmail, listDrive, googleApi } from "@/lib/integrations/google/api";
import { requestJson } from "@/lib/integrations/http";
import { decryptIntegrationToken } from "@/lib/integrationSecrets";
import { randomToken, sha256Hex } from "@/lib/crypto";
import { installationToken, githubRequest } from "@/lib/integrations/github/api";
import { recordActivity } from "@/lib/activity";
import { recordAuditEvent } from "@/lib/audit";
import type { ActionResult } from "@/lib/actionResult";
export async function updateIntegrations(slug: string, raw: unknown): Promise<ActionResult<{ url?: string; items?: { id: string; label: string; url?: string }[] }>> {
  try {
    const { workspace, user } = await integrationAccess(slug); const workspaceId = workspace.id;
    const input = z.object({ operation: z.enum(["google", "github", "disconnect", "syncRepos", "linkRepo", "calendars", "events", "gmail", "drive", "meeting", "draft"]), id: z.string().max(64).optional(), data: z.unknown().optional() }).parse(raw);
    const personal = ["calendars", "events", "gmail", "drive", "meeting", "draft"].includes(input.operation);
    const account = personal ? await prisma.integrationConnection.findFirst({ where: { workspaceId, provider: "GOOGLE", connectedById: user.id, status: "ACTIVE" }, orderBy: { createdAt: "desc" } }) : null;
    if (personal && !account) throw new Error("Connect your own Google account before opening personal services.");
    let url: string | undefined; let items: { id: string; label: string; url?: string }[] | undefined;
    if (input.operation === "google") url = await beginGoogle(workspaceId, user.id, slug);
    else if (input.operation === "github") {
      const name = process.env.GITHUB_APP_NAME; if (!name) throw new Error("Configure the GitHub App name first.");
      const state = randomToken(); await prisma.oAuthState.create({ data: { workspaceId, userId: user.id, provider: "GITHUB", stateHash: sha256Hex(state), expiresAt: new Date(Date.now() + 600000), redirectPath: `/w/${slug}/settings/integrations` } });
      url = `https://github.com/apps/${encodeURIComponent(name)}/installations/new?state=${encodeURIComponent(state)}`;
    } else if (input.operation === "disconnect") {
      const connection = await prisma.integrationConnection.findFirst({ where: { id: input.id ?? "", workspaceId } }); if (!connection) throw new Error("Connection not found.");
      if (connection.provider === "GOOGLE" && (connection.refreshTokenEnc || connection.accessTokenEnc)) {
        const revoked = await requestJson("https://oauth2.googleapis.com/revoke", { method: "POST", label: "Google", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: decryptIntegrationToken((connection.refreshTokenEnc ?? connection.accessTokenEnc)!) }) });
        if (!revoked.ok && revoked.status !== 400) throw new Error("Google could not revoke access. Try disconnecting again.");
      }
      await prisma.integrationConnection.deleteMany({ where: { id: connection.id, workspaceId } });
    } else if (input.operation === "syncRepos") {
      const connection = await prisma.integrationConnection.findFirst({ where: { id: input.id ?? "", workspaceId, provider: "GITHUB", status: "ACTIVE" } }); if (!connection) throw new Error("GitHub connection not found.");
      const metadata = connection.metadata as { allowedRepos?: string[] } | null;
      if (!metadata?.allowedRepos) throw new Error("Reconnect the GitHub App to authorise repository access.");
      const allowed = new Set(metadata.allowedRepos);
      const token = await installationToken(connection.externalId);
      for (let page = 1; page <= 10; page++) {
        const response = await githubRequest<{ repositories: { full_name: string; default_branch: string; private: boolean }[] }>(`/installation/repositories?per_page=100&page=${page}`, token);
        for (const repo of response.repositories.filter(repo => allowed.has(repo.full_name))) await prisma.githubRepo.upsert({ where: { workspaceId_fullName: { workspaceId, fullName: repo.full_name } }, create: { workspaceId, connectionId: connection.id, installationId: connection.externalId, fullName: repo.full_name, defaultBranch: repo.default_branch, private: repo.private }, update: { connectionId: connection.id, installationId: connection.externalId, defaultBranch: repo.default_branch, private: repo.private } });
        if (response.repositories.length < 100) break;
      }
    } else if (input.operation === "linkRepo") {
      const data = z.object({ projectId: z.string().max(64).nullable() }).parse(input.data);
      if (data.projectId && !await prisma.project.findFirst({ where: { id: data.projectId, workspaceId } })) throw new Error("Pick a project in this workspace.");
      await prisma.githubRepo.updateMany({ where: { id: input.id ?? "", workspaceId }, data: { linkedProjectId: data.projectId } });
    } else if (input.operation === "calendars") items = (await listCalendars(workspaceId, account!.id)).items?.map(i => ({ id: i.id, label: i.summary }));
    else if (input.operation === "events") items = (await listCalendarEvents(workspaceId, account!.id)).items?.map(i => ({ id: i.id, label: i.summary, url: i.htmlLink }));
    else if (input.operation === "drive") items = (await listDrive(workspaceId, account!.id)).files?.map(i => ({ id: i.id, label: `${i.name} (${i.mimeType})`, url: i.webViewLink }));
    else if (input.operation === "gmail") {
      const messages = (await listGmail(workspaceId, account!.id)).messages ?? [];
      items = await Promise.all(messages.map(async m => { const detail = await googleApi<{ id: string; snippet: string; payload?: { headers?: { name: string; value: string }[] } }>(workspaceId, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(m.id)}?format=metadata&metadataHeaders=Subject`, { connectionId: account!.id }); return { id: m.id, label: detail.payload?.headers?.find(h => h.name.toLowerCase() === "subject")?.value ?? detail.snippet, url: `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(m.id)}` }; }));
    } else if (input.operation === "meeting") {
      const data = z.object({ summary: z.string().trim().min(1).max(200), start: z.iso.datetime({ offset: true }), end: z.iso.datetime({ offset: true }) }).parse(input.data);
      if (Date.parse(data.end) <= Date.parse(data.start)) throw new Error("The meeting must end after it starts.");
      await googleApi(workspaceId, "https://www.googleapis.com/calendar/v3/calendars/primary/events", { method: "POST", connectionId: account!.id, body: { summary: data.summary, start: { dateTime: data.start, timeZone: workspace.timezone }, end: { dateTime: data.end, timeZone: workspace.timezone } } });
    } else if (input.operation === "draft") {
      const data = z.object({ to: z.email(), subject: z.string().min(1).max(200).regex(/^[^\r\n]+$/), body: z.string().min(1).max(50000) }).parse(input.data);
      const subject = `=?UTF-8?B?${Buffer.from(data.subject).toString("base64")}?=`;
      const raw = Buffer.from(`To: ${data.to}\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(data.body).toString("base64")}`).toString("base64url");
      await googleApi(workspaceId, "https://gmail.googleapis.com/gmail/v1/users/me/drafts", { method: "POST", connectionId: account!.id, body: { message: { raw } } });
    }
    await recordAuditEvent({ workspaceId, actorId: user.id, action: `integrations.${input.operation}`, targetId: input.id });
    if (["disconnect", "linkRepo"].includes(input.operation)) await recordActivity({ workspaceId, actorId: user.id, verb: "updated", entityType: "integration", entityId: input.id ?? workspaceId, summary: "Updated workspace integration settings.", visibility: "PRIVATE" });
    revalidatePath(`/w/${slug}/settings/integrations`);
    return { ok: true, data: { ...(url ? { url } : {}), ...(items ? { items } : {}) } };
  } catch (error) { return { ok: false, error: error instanceof z.ZodError ? "Check the integration fields." : error instanceof Error && error.name === "Error" && !error.message.toLowerCase().includes("prisma") ? error.message.slice(0, 180) : "Couldn't update the integration. Try again." }; }
}
