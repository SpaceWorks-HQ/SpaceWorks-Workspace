import "server-only";
import { endpoint, type ApiClient } from "../http";
import { array as a, object as o, string as s, number as n, date, day, section, snapshot, type Metrics, type RemotePost, type RemoteComment, type SyncInput } from "../types";
export const LI = "https://api.linkedin.com/rest/";
export function mapLinkedinStats(raw: unknown): Metrics {
  const v = o(raw); return { impressions: n(v.impressionCount), clicks: n(v.clickCount), likes: n(v.likeCount), comments: n(v.commentCount), shares: n(v.shareCount), engagements_rate: n(v.engagement), reach: n(v.uniqueImpressionsCount) };
}
export function mapLinkedinPost(raw: unknown): RemotePost {
  const v = o(raw), id = s(v.id); return { externalId: id, url: `https://www.linkedin.com/feed/update/${encodeURIComponent(id)}/`, text: s(v.commentary).slice(0, 2000), mediaType: Object.keys(o(v.content))[0] ?? "POST", publishedAt: date(v.publishedAt ?? v.createdAt), metrics: {} };
}
/** A nested response needs parentComment as well as the comment target.
 * https://learn.microsoft.com/linkedin/marketing/community-management/shares/comments-api#additional-comment-features */
export function linkedinReplyBody(actor: string, postId: string, commentUrn: string, text: string) {
  return { actor, object: postId, parentComment: commentUrn, message: { text } };
}
export function mapLinkedinComment(raw: unknown, postId: string, parent?: string): RemoteComment {
  const v = o(raw); return { externalId: s(v.commentUrn) || (s(v.object).startsWith("urn:li:") && s(v.id) ? `urn:li:comment:(${s(v.object)},${s(v.id)})` : s(v.id)), postExternalId: postId, parentExternalId: parent, authorName: s(v.actor, "LinkedIn member"), text: s(o(v.message).text), publishedAt: date(o(v.created).time), likeCount: n(o(v.likesSummary).aggregatedTotalLikes) ?? 0 };
}
export async function linkedinSync(input: SyncInput, api: ApiClient) {
  const out = snapshot(), { account, now } = input, enc = encodeURIComponent;
  await section(out, "Followers", async () => { const data = await api(endpoint(LI, `networkSizes/${enc(account.externalId)}`, { edgeType: "CompanyFollowedByMember" })); const count = n(data.firstDegreeSize); if (count !== undefined) out.metrics.push({ date: day(now), metric: "followers", value: count }); });
  if (input.daily) {
    const start = day(new Date(now.getTime() - 90 * 86400000)).getTime(), end = day(now).getTime(); const intervals = `(timeRange:(start:${start},end:${end}),timeGranularityType:DAY)`;
    await section(out, "Daily share statistics", async () => { const data = await api(endpoint(LI, "organizationalEntityShareStatistics", { q: "organizationalEntity", organizationalEntity: account.externalId, timeIntervals: intervals })); for (const row of a(data.elements)) { const v = o(row); for (const [metric, value] of Object.entries(mapLinkedinStats(v.totalShareStatistics))) if (value !== undefined) out.metrics.push({ date: day(date(o(v.timeRange).start)), metric, value }); } out.metricsComplete = true; });
    await section(out, "Follower growth", async () => { const data = await api(endpoint(LI, "organizationalEntityFollowerStatistics", { q: "organizationalEntity", organizationalEntity: account.externalId, timeIntervals: intervals })); for (const row of a(data.elements)) { const v = o(row), counts = o(v.followerGains); const organic = n(counts.organicFollowerGain), paid = n(counts.paidFollowerGain); if (organic !== undefined || paid !== undefined) out.metrics.push({ date: day(date(o(v.timeRange).start)), metric: "followers_gained", value: (organic ?? 0) + (paid ?? 0) }); } });
  }
  await section(out, "Posts", async () => { const saved = n(o(account.cursor).posts) ?? 0; for (const start of saved ? [0, saved] : [0]) { const data = await api(endpoint(LI, "posts", { q: "author", author: account.externalId, count: 50, start, sortBy: "LAST_MODIFIED" })); const rows = a(data.elements); out.posts.push(...rows.map(mapLinkedinPost)); out.cursor.posts = rows.length === 50 ? String(start + 50) : ""; } });
  const posts = [...new Map([...out.posts.slice(0, 20), ...input.recentPosts].map(p => [p.externalId, p])).values()];
  for (const post of posts.slice(0, 30)) {
    if (input.daily) await section(out, "Post statistics", async () => { const data = await api(endpoint(LI, "organizationalEntityShareStatistics", { q: "organizationalEntity", organizationalEntity: account.externalId, [post.externalId.startsWith("urn:li:ugcPost:") ? "ugcPosts" : "shares"]: `List(${post.externalId})` })); const row = out.posts.find(p => p.externalId === post.externalId); if (row) row.metrics = mapLinkedinStats(o(a(data.elements)[0]).totalShareStatistics); });
    await section(out, "Comments", async () => { const key = `comments:${post.externalId}`, start = n(o(account.cursor)[key]) ?? 0; const data = await api(endpoint(LI, `socialActions/${enc(post.externalId)}/comments`, { count: 100, start })); const comments = a(data.elements); for (const raw of comments) { const mapped = { ...mapLinkedinComment(raw, post.externalId), ours: s(o(raw).actor) === account.externalId }; out.comments.push(mapped); if ((n(o(o(raw).commentsSummary).totalFirstLevelComments) ?? 0) > 0) { const replyKey = `replies:${mapped.externalId}`, replyStart = n(o(account.cursor)[replyKey]) ?? 0; const replies = await api(endpoint(LI, `socialActions/${enc(mapped.externalId)}/comments`, { count: 100, start: replyStart })); out.comments.push(...a(replies.elements).map(v => ({ ...mapLinkedinComment(v, post.externalId, mapped.externalId), ours: s(o(v).actor) === account.externalId }))); out.cursor[replyKey] = a(replies.elements).length === 100 ? String(replyStart + 100) : ""; if (out.cursor[replyKey]) out.warnings.push("More LinkedIn replies are waiting for the next sync."); } } out.cursor[key] = comments.length === 100 ? String(start + 100) : ""; });
  }
  return out;
}
