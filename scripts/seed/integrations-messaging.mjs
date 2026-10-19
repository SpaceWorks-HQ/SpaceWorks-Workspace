/** Safe demo routing and search performance; no live credentials or outbound deliveries. */
export async function seedIntegrationsMessaging(prisma, { workspaceId, users, channels }) {
  const destination = await prisma.notificationDestination.create({ data: { workspaceId, name: "Build night updates", kind: "WORKSPACE_CHANNEL", config: { channelId: channels.general.id, memberSelectable: true }, createdById: users.owner.id } });
  await prisma.notificationRule.create({ data: { workspaceId, name: "Community news", eventTypes: ["announcement.*", "event.*"], createdById: users.owner.id, destinations: { create: { destinationId: destination.id } } } });
  const site = await prisma.seoSite.create({ data: { workspaceId, siteUrl: "https://spaceworks.example.org/", verified: false } });
  const rows = [];
  for (let day = 1; day <= 14; day++) {
    const date = new Date(); date.setUTCDate(date.getUTCDate() - day - 3); date.setUTCHours(0, 0, 0, 0);
    const clicks = 30 + (14 - day) * 3; const impressions = clicks * 14;
    rows.push({ siteId: site.id, date, clicks, impressions, ctr: clicks / impressions, position: 9 - (14 - day) / 5 });
    rows.push({ siteId: site.id, date, query: "maker community kochi", clicks: Math.round(clicks * 0.7), impressions: Math.round(impressions * 0.6), ctr: 0.08, position: 5 });
    rows.push({ siteId: site.id, date, page: "https://spaceworks.example.org/build-nights", clicks: Math.round(clicks * 0.8), impressions: Math.round(impressions * 0.8), ctr: clicks / impressions, position: 6 });
  }
  await prisma.seoMetricDaily.createMany({ data: rows });
  await prisma.seoAudit.create({ data: { siteId: site.id, url: "https://spaceworks.example.org/build-nights", status: "done", score: 89, createdById: users.owner.id, findings: [{ check: "title", passed: true, message: "Title has a useful length." }, { check: "description", passed: false, message: "Add a meta description of 50–160 characters." }] } });
}
