// Paused demo apps have no credentials and never contact either store.
export default async function seedAppReviews(prisma, { workspaceId, workspace, users }) {
  if (process.env.NODE_ENV === "production") throw new Error("Demo seeds are for local development only.");
  const samples = [
    { platform: "APPLE", identifier: "1234567890", name: "Space Works Pocket", reviews: [
      [5, "Build nights in my pocket", "Finding the next build night is easy. Thanks for making this.", "Meera", "en"],
      [2, "Sign-in needs another try", "The sign-in screen freezes after an update. Restarting helps.", "A maker", "en"],
      [4, "Useful at the workbench", "The project checklist keeps our group on track.", "Jo", "en"],
      [3, "Text could be larger", "Please add a larger text option for the project cards.", "A builder", "en"],
    ] },
    { platform: "GOOGLE", identifier: "org.spaceworks.pocket.demo", name: "Space Works Pocket for Android", reviews: [
      [1, "Upload stops on mobile data", "Photos stop uploading when I switch from Wi-Fi to mobile data.", "Rahul", "en"],
      [5, "Helps our crew", "Keeping notes and projects together saves us time every week.", "Anjali", "en"],
      [4, "Easy to find events", "The calendar and reminders are useful.", "Nila", "ml"],
      [2, "Notifications arrive late", "Build-night reminders arrive after the event starts.", "Sam", "en"],
    ] },
  ];
  const userList = users instanceof Map ? [...users.values()] : Array.isArray(users) ? users : Object.values(users ?? {});
  const actorId = userList.find(u => u?.id)?.id ?? null;
  for (const sample of samples) {
    const accountId = `demo-app-reviews-${workspaceId}-${sample.platform.toLowerCase()}`;
    const account = await prisma.appStoreAccount.upsert({ where: { id: accountId }, create: { id: accountId, workspaceId, platform: sample.platform, name: `Demo ${sample.platform === "APPLE" ? "App Store" : "Google Play"} account`, active: false }, update: {} });
    const app = await prisma.reviewedApp.upsert({ where: { workspaceId_platform_appIdentifier: { workspaceId, platform: sample.platform, appIdentifier: sample.identifier } }, create: { workspaceId, accountId: account.id, platform: sample.platform, appIdentifier: sample.identifier, name: sample.name, active: false, allowNoProxy: false }, update: {} });
    for (const [i, [rating, title, body, author, language]] of sample.reviews.entries()) {
      const storeCreatedAt = new Date(Date.now() - (i + (sample.platform === "GOOGLE" ? 5 : 1)) * 86400000);
      const replied = i % 3 === 0;
      const data = { workspaceId, appId: app.id, platform: sample.platform, externalReviewId: `demo-${i}`, rating, title, body, author, language, territory: sample.platform === "APPLE" ? "IND" : null, appVersion: sample.platform === "GOOGLE" ? "2.1.0" : null, storeCreatedAt, storeUpdatedAt: storeCreatedAt, status: replied ? "DONE" : rating <= 2 ? "IN_PROGRESS" : "NEW", assigneeId: rating <= 2 ? actorId : null, tags: rating <= 2 ? ["needs-attention"] : ["demo"], ...(replied ? { replyBody: "Thanks for sharing this. Your feedback helps the crew improve the app.", replyStatus: "SENT", replyPublishState: "PUBLISHED", replySentAt: new Date(storeCreatedAt.getTime() + 3600000), repliedById: actorId } : {}) };
      const review = await prisma.appReview.upsert({ where: { workspaceId_appId_externalReviewId: { workspaceId, appId: app.id, externalReviewId: data.externalReviewId } }, create: data, update: {} });
      if (replied) {
        const triggerKey = `demo:${review.id}:reply`;
        await prisma.appReviewReplyAttempt.upsert({ where: { workspaceId_triggerKey: { workspaceId, triggerKey } }, create: { workspaceId, reviewId: review.id, triggerKey, source: "WORKSPACE", actorId, body: data.replyBody, status: "SENT", createdAt: data.replySentAt, finishedAt: data.replySentAt }, update: {} });
      }
      const search = { workspaceId, title: `${app.name}: ${title}`, body: `${author}\n${body}`, url: `/w/${workspace.slug}/app-reviews/${review.id}`, visibility: "PRIVATE" };
      await prisma.searchDocument.upsert({ where: { entityType_entityId: { entityType: "app_review", entityId: review.id } }, create: { entityType: "app_review", entityId: review.id, ...search }, update: search });
    }
  }
}
