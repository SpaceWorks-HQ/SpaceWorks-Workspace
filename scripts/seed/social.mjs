// Demo accounts carry no credentials and cannot sync or send replies.
export default async function seedSocial(prisma, { workspaceId, users }) {
  if (process.env.NODE_ENV === "production") throw new Error("Demo seeds are for local development only.");
  const userList = users instanceof Map ? [...users.values()] : Array.isArray(users) ? users : Object.values(users ?? {});
  const actorId = userList.find(u => u?.id)?.id ?? null;
  const platforms = ["YOUTUBE", "FACEBOOK", "INSTAGRAM", "LINKEDIN", "X"];
  const today = new Date(new Date().toISOString().slice(0, 10));
  for (const [i, platform] of platforms.entries()) {
    const externalId = `spaceworks-demo-${platform.toLowerCase()}`;
    const account = await prisma.socialAccount.upsert({ where: { workspaceId_platform_externalId: { workspaceId, platform, externalId } }, create: { workspaceId, platform, externalId, displayName: `Space Works · ${platform === "X" ? "X" : platform.charAt(0) + platform.slice(1).toLowerCase()} demo`, handle: "spaceworks-demo", status: "DEMO", connectedById: actorId, lastSyncedAt: new Date(), warnings: ["Sample data. Connect a real account to sync or reply."] }, update: {} });
    const metrics = [];
    for (let ago = 90; ago >= 0; ago--) {
      const date = new Date(today.getTime() - ago * 86400000), scale = i + 1;
      const values = { followers: 800 + scale * 150 + (90 - ago) * scale, views: 140 * scale + (ago % 7) * 35, likes: 12 * scale + ago % 5, comments: 2 + ago % 4, shares: 3 * scale, reach: 100 * scale + ago % 6 * 20 };
      for (const [metric, value] of Object.entries(values)) metrics.push({ workspaceId, accountId: account.id, date, metric, value });
    }
    await prisma.socialMetricDaily.createMany({ data: metrics, skipDuplicates: true });
    for (let j = 0; j < 4; j++) {
      const publishedAt = new Date(today.getTime() - (j + 1) * 86400000);
      const values = { likes: 25 * (i + 1) + j * 3, comments: j + 2, shares: i + 1, views: 250 * (i + 1), reach: 180 * (i + 1) };
      const post = await prisma.socialPost.upsert({ where: { workspaceId_accountId_externalId: { workspaceId, accountId: account.id, externalId: `demo-post-${j}` } }, create: { workspaceId, accountId: account.id, externalId: `demo-post-${j}`, text: ["The workbench is ready for build night.", "A look at what the crew made this week.", "New to making? Join our next open workshop.", "Thanks to everyone who shared a skill this weekend."][j], mediaType: platform === "YOUTUBE" ? "VIDEO" : "POST", publishedAt, latestMetrics: values, ...values }, update: {} });
      const replied = j === 1;
      await prisma.socialComment.upsert({ where: { workspaceId_accountId_externalId: { workspaceId, accountId: account.id, externalId: `demo-comment-${j}` } }, create: { workspaceId, accountId: account.id, postId: post.id, externalId: `demo-comment-${j}`, authorName: ["Meera", "Jo", "A maker", "Nila"][j], text: ["What time does build night start?", "Can beginners join the workshop?", "Could our team visit the space?", "Thanks for sharing the project notes."][j], publishedAt: new Date(publishedAt.getTime() + 3600000), likeCount: j, status: replied ? "REPLIED" : j === 2 ? "SEEN" : "NEW", assigneeId: j === 2 ? actorId : null, ...(replied ? { replyState: "SENT", replyText: "Yes, beginners are welcome. Bring your curiosity and we will help you get started.", replyExternalId: `demo-reply-${j}`, repliedById: actorId, repliedAt: new Date(publishedAt.getTime() + 7200000) } : {}) }, update: {} });
    }
  }
}
