import "server-only";
import { endpoint, type ApiClient, SocialApiError, X_ACCESS_MESSAGE } from "../http";
import { array as a, object as o, string as s, number as n, date, day, section, snapshot, type RemotePost, type RemoteComment, type SyncInput } from "../types";
export const XAPI = "https://api.x.com/2/";
export function mapXPost(raw: unknown): RemotePost {
  const v = o(raw), pub = o(v.public_metrics), own = o(v.organic_metrics), privateMetrics = o(v.non_public_metrics);
  return { externalId: s(v.id), url: `https://x.com/i/status/${encodeURIComponent(s(v.id))}`, text: s(v.text).slice(0, 2000), mediaType: "POST", publishedAt: date(v.created_at), metrics: { likes: n(pub.like_count), comments: n(pub.reply_count), shares: n(pub.retweet_count), impressions: n(own.impression_count ?? privateMetrics.impression_count ?? pub.impression_count), clicks: n(own.url_link_clicks ?? privateMetrics.url_link_clicks), profile_clicks: n(own.user_profile_clicks ?? privateMetrics.user_profile_clicks), bookmarks: n(pub.bookmark_count) } };
}
export function mapXReply(raw: unknown, postId: string, users: unknown[]): RemoteComment {
  const v = o(raw), user = o(users.find(x => s(o(x).id) === s(v.author_id))), parent = a(v.referenced_tweets).map(o).find(x => x.type === "replied_to");
  return { externalId: s(v.id), postExternalId: postId, parentExternalId: s(parent?.id) || undefined, authorName: s(user.name, "X member"), authorHandle: s(user.username) || undefined, text: s(v.text), authorAvatarUrl: s(user.profile_image_url) || undefined, publishedAt: date(v.created_at), likeCount: n(o(v.public_metrics).like_count) ?? 0 };
}
export async function xSync(input: SyncInput, api: ApiClient) {
  const out = snapshot(), { account, now } = input;
  await section(out, "Followers", async () => { const data = await api(endpoint(XAPI, "users/me", { "user.fields": "public_metrics" })); const count = n(o(o(data.data).public_metrics).followers_count); if (count !== undefined) out.metrics.push({ date: day(now), metric: "followers", value: count }); });
  await section(out, "Posts", async () => {
    const request = (privateFields: boolean, paginationToken?: string) => api(endpoint(XAPI, `users/${encodeURIComponent(account.externalId)}/tweets`, { max_results: 100, exclude: "replies,retweets", "tweet.fields": `created_at,public_metrics,conversation_id${privateFields ? ",non_public_metrics,organic_metrics" : ""}`, pagination_token: paginationToken }));
    let data: Record<string, unknown>; try { data = await request(true); } catch (e) { if (!(e instanceof SocialApiError) || !["ACCESS", "REMOTE"].includes(e.kind)) throw e; out.warnings.push(X_ACCESS_MESSAGE); data = await request(false); }
    out.posts.push(...a(data.data).map(mapXPost)); const saved = s(o(account.cursor).posts); if (saved) { const older = await request(false, saved); out.posts.push(...a(older.data).map(mapXPost)); out.cursor.posts = s(o(older.meta).next_token); } else out.cursor.posts = s(o(data.meta).next_token);
    out.metricsComplete = input.daily;
  });
  // Recent search is a rolling seven-day window, not a historical inbox.
  // https://docs.x.com/x-api/posts/search/introduction
  const posts = [...new Map([...out.posts, ...input.recentPosts].map(p => [p.externalId, p])).values()].filter(p => now.getTime() - p.publishedAt.getTime() < 7 * 86400000).slice(0, 20);
  await section(out, "Reply search", async () => { for (const post of posts) { const key = `replies:${post.externalId}`; const data = await api(endpoint(XAPI, "tweets/search/recent", { query: `conversation_id:${post.externalId} -from:${account.handle ?? account.externalId}`, max_results: 100, "tweet.fields": "created_at,author_id,public_metrics,referenced_tweets", expansions: "author_id", "user.fields": "name,username,profile_image_url", next_token: s(o(account.cursor)[key]) || undefined })); out.comments.push(...a(data.data).map(v => mapXReply(v, post.externalId, a(o(data.includes).users)))); out.cursor[key] = s(o(data.meta).next_token); } });
  out.warnings.push("X provides post metric snapshots. Historical daily reach and engagement totals are unavailable from these endpoints.");
  return out;
}
