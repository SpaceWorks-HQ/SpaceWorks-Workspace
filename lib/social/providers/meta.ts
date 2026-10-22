import "server-only";
import { META_VERSION } from "../config";
import { endpoint, type ApiClient } from "../http";
import { array as a, object as o, string as s, number as n, date, day, section, snapshot, type RemotePost, type RemoteComment, type DailyMetric, type SyncInput } from "../types";
export const META = `https://graph.facebook.com/${META_VERSION}/`;
export function mapMetaPost(raw: unknown, instagram: boolean): RemotePost {
  const v = o(raw), likes = o(v.likes), comments = o(v.comments);
  return { externalId: s(v.id), url: s(v.permalink ?? v.permalink_url) || undefined, text: s(v.message ?? v.caption).slice(0, 2000), mediaType: s(v.media_type, "POST"), publishedAt: date(v.timestamp ?? v.created_time), metrics: { likes: instagram ? n(v.like_count) : n(o(likes.summary).total_count), comments: instagram ? n(v.comments_count) : n(o(comments.summary).total_count), shares: n(o(v.shares).count) } };
}
export function mapMetaComment(raw: unknown, postId: string, parent?: string): RemoteComment {
  const v = o(raw), from = o(v.from);
  return { externalId: s(v.id), postExternalId: postId, parentExternalId: parent ?? (s(o(v.parent).id) || undefined), authorName: s(from.name ?? v.username, "Platform member"), authorHandle: s(v.username) || undefined, text: s(v.message ?? v.text), publishedAt: date(v.timestamp ?? v.created_time), likeCount: n(v.like_count) ?? 0, hidden: typeof v.is_hidden === "boolean" ? v.is_hidden : typeof v.hidden === "boolean" ? v.hidden : undefined };
}
export function mapInsights(raw: unknown, fallback: Date, metricNames: Record<string, string> = {}): DailyMetric[] {
  return a(o(raw).data).flatMap(rawRow => { const row = o(rawRow), key = metricNames[s(row.name)] ?? s(row.name); const values = a(row.values); if (values.length) return values.flatMap(v => { const item = o(v), value = n(item.value); return value === undefined ? [] : [{ date: item.end_time ? day(new Date(date(item.end_time).getTime() - 86400000)) : day(fallback), metric: key, value }]; }); const total = n(o(row.total_value).value); return total === undefined ? [] : [{ date: day(fallback), metric: key, value: total }]; });
}
export async function metaSync(input: SyncInput, api: ApiClient) {
  const out = snapshot(), { account, now } = input, ig = account.platform === "INSTAGRAM"; const enc = encodeURIComponent;
  await section(out, "Followers", async () => { const data = await api(endpoint(META, enc(account.externalId), { fields: ig ? "followers_count" : "followers_count" })); const count = n(data.followers_count); if (count !== undefined) out.metrics.push({ date: day(now), metric: "followers", value: count }); });
  const today = day(now), yesterday = day(new Date(now.getTime() - 86400000));
  const historyDone = s(o(account.cursor).metaHistoryDone) === "true";
  if (input.daily || !historyDone) {
    // Views replace legacy impressions. Unsupported metrics fail independently.
    // https://developers.facebook.com/docs/graph-api/reference/page/insights/
    // https://developers.facebook.com/docs/instagram-platform/reference/instagram-user/insights/
    const metrics = ig ? ["reach", "views", "profile_views", "accounts_engaged", "total_interactions", "profile_links_taps", "likes", "comments", "saves", "shares"] : ["page_media_view", "page_total_media_view_unique", "page_post_engagements", "page_views_total", "page_daily_follows_unique", "page_daily_unfollows_unique"];
    const names = { page_media_view: "views", page_post_engagements: "engagements", page_total_media_view_unique: "reach", page_daily_follows_unique: "followers_gained", page_daily_unfollows_unique: "followers_lost", total_interactions: "engagements" };
    let historical = new Date(s(o(account.cursor).metaHistoryDate) || new Date(today.getTime() - 90 * 86400000).toISOString());
    if (!Number.isFinite(historical.getTime())) historical = new Date(today.getTime() - 90 * 86400000);
    const dates = input.daily ? [yesterday] : [];
    for (let i = 0; !historyDone && i < 5 && historical < yesterday; i++) { dates.push(new Date(historical)); historical = new Date(historical.getTime() + 86400000); }
    for (const reportDate of dates) {
      const since = Math.floor(reportDate.getTime() / 1000), until = since + 86400; let successful = 0;
      for (const metric of metrics) await section(out, metric, async () => { const data = await api(endpoint(META, `${enc(account.externalId)}/insights`, { metric, period: "day", since, until, ...(ig ? { metric_type: "total_value" } : {}) })); out.metrics.push(...mapInsights(data, reportDate, names)); successful++; });
      if (ig) await section(out, "Follows and unfollows", async () => { const data = await api(endpoint(META, `${enc(account.externalId)}/insights`, { metric: "follows_and_unfollows", period: "day", metric_type: "total_value", breakdown: "follow_type", since, until })); for (const row of a(data.data)) for (const breakdown of a(o(o(row).total_value).breakdowns)) for (const item of a(o(breakdown).results)) { const r = o(item), value = n(r.value), kind = s(a(r.dimension_values)[0]); if (value !== undefined && ["FOLLOWER", "NON_FOLLOWER"].includes(kind)) out.metrics.push({ date: reportDate, metric: kind === "FOLLOWER" ? "followers_gained" : "followers_lost", value }); } });
      if (!successful) break;
      if (reportDate.getTime() === yesterday.getTime()) out.metricsComplete = true;
      else { out.cursor.metaHistoryDate = new Date(reportDate.getTime() + 86400000).toISOString(); if (new Date(out.cursor.metaHistoryDate) >= yesterday) out.cursor.metaHistoryDone = "true"; }
      if (out.error && ["RATE_LIMIT", "TOKEN", "UNKNOWN"].includes(s((out.error as { kind?: string }).kind))) break;
    }
    if (!historyDone && historical >= yesterday && !out.cursor.metaHistoryDone && !dates.some(d => d < yesterday)) out.cursor.metaHistoryDone = "true";
  }
  await section(out, "Posts", async () => { const after = s(o(account.cursor).posts); const cursors = after ? [undefined, after] : [undefined]; for (const cursor of cursors) { const data = await api(endpoint(META, `${enc(account.externalId)}/${ig ? "media" : "published_posts"}`, { fields: ig ? "id,caption,media_type,permalink,timestamp,like_count,comments_count" : "id,message,created_time,permalink_url,shares,likes.limit(0).summary(true),comments.limit(0).summary(true)", limit: 50, after: cursor })); out.posts.push(...a(data.data).map(v => mapMetaPost(v, ig))); out.cursor.posts = o(data.paging).next ? s(o(o(data.paging).cursors).after) : ""; } });
  const posts = [...new Map([...out.posts.slice(0, 20), ...input.recentPosts].map(p => [p.externalId, p])).values()];
  for (const post of posts.slice(0, 30)) {
    if (input.daily) await section(out, "Post insights", async () => { const row = out.posts.find(p => p.externalId === post.externalId); if (!row) return; const metrics = ig ? (row.mediaType === "VIDEO" || row.mediaType === "REELS" ? "reach,likes,comments,saved,shares,views" : "reach,likes,comments,saved,shares,views") : "post_media_view,post_total_media_view_unique,post_clicks"; const data = await api(endpoint(META, `${enc(post.externalId)}/insights`, { metric: metrics })); for (const v of mapInsights(data, now, { post_media_view: "views", post_total_media_view_unique: "reach", saved: "saves" })) row.metrics[v.metric] = v.value; });
    await section(out, "Comments", async () => {
      const key = `comments:${post.externalId}`, after = s(o(account.cursor)[key]);
      const data = await api(endpoint(META, `${enc(post.externalId)}/comments`, { fields: ig ? "id,text,username,timestamp,like_count,hidden" : "id,message,from,created_time,like_count,is_hidden,parent{id}", limit: 100, after: after || undefined, ...(ig ? {} : { order: "reverse_chronological", filter: "stream" }) }));
      for (const item of a(data.data)) { const mapped = { ...mapMetaComment(item, post.externalId), ours: ig ? s(o(item).username) === account.handle : s(o(o(item).from).id) === account.externalId }; out.comments.push(mapped); if (ig) { const replyKey = `replies:${mapped.externalId}`; const replies = await api(endpoint(META, `${enc(mapped.externalId)}/replies`, { fields: "id,text,username,timestamp,like_count", limit: 100, after: s(o(account.cursor)[replyKey]) || undefined })); out.comments.push(...a(replies.data).map(v => ({ ...mapMetaComment(v, post.externalId, mapped.externalId), ours: s(o(v).username) === account.handle }))); out.cursor[replyKey] = o(replies.paging).next ? s(o(o(replies.paging).cursors).after) : ""; if (out.cursor[replyKey]) out.warnings.push("More Instagram replies are waiting for the next sync."); } }
      out.cursor[key] = o(data.paging).next ? s(o(o(data.paging).cursors).after) : "";
    });
  }
  return out;
}
