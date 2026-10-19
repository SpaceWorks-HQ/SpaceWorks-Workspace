import "server-only";
import { findGoogleConnection, getGoogleAccessToken } from "./tokens";
import { requestJson } from "@/lib/integrations/http";
export async function googleApi<T>(workspaceId: string, url: string, init: { method?: string; body?: unknown; connectionId?: string } = {}): Promise<T> {
  const connection = await findGoogleConnection(workspaceId, init.connectionId); if (!connection) throw new Error("Connect Google in integration settings first.");
  const token = await getGoogleAccessToken(connection); if (!token.ok) throw new Error(token.error);
  const result = await requestJson<T>(url, { method: init.method, body: init.body, label: "Google", headers: { Authorization: `Bearer ${token.token}` } });
  if (!result.ok) throw new Error(result.error); return result.data;
}
export const listCalendars = (workspaceId: string, connectionId?: string) => googleApi<{ items?: { id: string; summary: string }[] }>(workspaceId, "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=100", { connectionId });
export const listCalendarEvents = (workspaceId: string, connectionId?: string) => googleApi<{ items?: { id: string; summary: string; htmlLink?: string }[] }>(workspaceId, `https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=30&singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(new Date().toISOString())}`, { connectionId });
export const listGmail = (workspaceId: string, connectionId?: string) => googleApi<{ messages?: { id: string; threadId: string }[] }>(workspaceId, "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20", { connectionId });
export const listDrive = (workspaceId: string, connectionId?: string) => googleApi<{ files?: { id: string; name: string; mimeType: string; webViewLink?: string }[] }>(workspaceId, "https://www.googleapis.com/drive/v3/files?pageSize=50&fields=files(id,name,mimeType,webViewLink)&q=trashed%3Dfalse", { connectionId });
export const searchConsoleSites = (workspaceId: string) => googleApi<{ siteEntry?: { siteUrl: string; permissionLevel: string }[] }>(workspaceId, "https://www.googleapis.com/webmasters/v3/sites");
export const searchConsoleUrl = (siteUrl: string, suffix: string) => `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}${suffix}`;
