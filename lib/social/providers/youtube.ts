import "server-only";
import { endpoint, type ApiClient } from "../http";
import { array as a, object as o, string as s, number as n, date, day, section, snapshot, type RemotePost, type RemoteComment, type SyncInput } from "../types";
export const YT = "https://www.googleapis.com/youtube/v3/";
export function mapVideo(raw: unknown): RemotePost {
  const v = o(raw), snippet = o(v.snippet), stats = o(v.statistics); const id = s(v.id);
  return { externalId: id, url: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`, text: s(snippet.title), publishedAt: date(snippet.publishedAt), mediaType: "VIDEO", metrics: { views: n(stats.viewCount), likes: n(stats.likeCount), comments: n(stats.commentCount) } };
}
export function mapYoutubeComment(raw: unknown, postId: string, parent?: string): RemoteComment {
  const v = o(raw), sn = o(v.snippet);
  return { externalId: s(v.id), postExternalId: postId, parentExternalId: parent, authorName: s(sn.authorDisplayName, "YouTube viewer"), authorAvatarUrl: s(sn.authorProfileImageUrl) || undefined, text: s(sn.textOriginal, s(sn.textDisplay)), publishedAt: date(sn.publishedAt), likeCount: n(sn.likeCount) ?? 0 };
}
export async function youtubeSync(input: SyncInput, api: ApiClient) {
  const out = snapshot(); const { account, now } = input;
  await section(out, "Channel", async () => { const data = await api(endpoint(YT, "channels", { part: "statistics", id: account.externalId })); const stats = o(o(a(data.items)[0]).statistics); const followers = n(stats.subscriberCount); if (followers !== undefined && !stats.hiddenSubscriberCount) out.metrics.push({ date: day(now), metric: "followers", value: followers }); });
  if (input.daily) await section(out, "Daily analytics", async () => {
    // Time-based channel report supports this combination. https://developers.google.com/youtube/analytics/channel_reports
    const data = await api(endpoint("https://youtubeanalytics.googleapis.com/v2/", "reports", { ids: `channel==${account.externalId}`, startDate: new Date(now.getTime() - 90 * 86400000).toISOString().slice(0, 10), endDate: new Date(now.getTime() - 86400000).toISOString().slice(0, 10), dimensions: "day", metrics: "views,estimatedMinutesWatched,averageViewDuration,likes,comments,shares,subscribersGained,subscribersLost", sort: "day" }));
    const names = a(data.columnHeaders).map(x => s(o(x).name)); const keys: Record<string, string> = { estimatedMinutesWatched: "watch_minutes", averageViewDuration: "average_view_seconds", subscribersGained: "followers_gained", subscribersLost: "followers_lost" };
    for (const raw of a(data.rows)) { const row = a(raw); names.forEach((key, i) => { const v = n(row[i]); if (key !== "day" && v !== undefined) out.metrics.push({ date: date(row[0]), metric: keys[key] ?? key, value: v }); }); } out.metricsComplete = true;
  });
  await section(out, "Videos", async () => {
    const channels = await api(endpoint(YT, "channels", { part: "contentDetails", id: account.externalId })); const playlist = s(o(o(o(a(channels.items)[0]).contentDetails).relatedPlaylists).uploads); if (!playlist) throw new Error("The channel has no uploads playlist.");
    const saved = s(o(account.cursor).videos); const tokens = saved ? [undefined, saved] : [undefined];
    for (const pageToken of tokens) { const list = await api(endpoint(YT, "playlistItems", { part: "contentDetails", playlistId: playlist, maxResults: 50, pageToken })); const ids = a(list.items).map(x => s(o(o(x).contentDetails).videoId)).filter(Boolean); if (ids.length) { const videos = await api(endpoint(YT, "videos", { part: "snippet,statistics", id: ids.join(",") })); out.posts.push(...a(videos.items).map(mapVideo)); } out.cursor.videos = s(list.nextPageToken); }
  });
  await section(out, "Comments", async () => {
    const saved = s(o(account.cursor).comments); const tokens = saved ? [undefined, saved] : [undefined];
    for (const pageToken of tokens) {
      const data = await api(endpoint(YT, "commentThreads", { part: "snippet", allThreadsRelatedToChannelId: account.externalId, order: "time", textFormat: "plainText", maxResults: 100, pageToken }));
      for (const raw of a(data.items)) { const thread = o(raw), sn = o(thread.snippet), top = o(sn.topLevelComment), postId = s(sn.videoId); if (!postId) continue; out.comments.push({ ...mapYoutubeComment(top, postId), ours: s(o(o(top.snippet).authorChannelId).value) === account.externalId });
        if ((n(sn.totalReplyCount) ?? 0) > 0) { const replyKey = `replies:${s(top.id)}`; let next = s(o(account.cursor)[replyKey]) || undefined; let count = 0; do { const replies = await api(endpoint(YT, "comments", { part: "snippet", parentId: s(top.id), textFormat: "plainText", maxResults: 100, pageToken: next })); out.comments.push(...a(replies.items).map(x => ({ ...mapYoutubeComment(x, postId, s(top.id)), ours: s(o(o(o(x).snippet).authorChannelId).value) === account.externalId }))); next = s(replies.nextPageToken) || undefined; } while (next && ++count < 10); out.cursor[replyKey] = next ?? ""; if (next) out.warnings.push("More YouTube replies are waiting for the next sync."); }
      } out.cursor.comments = s(data.nextPageToken);
    }
  });
  return out;
}
