import Link from "next/link";
import { Card, CardHeader, PageHeader, StatTile } from "@/components/ui/display";
import { prisma } from "@/lib/db";
import { getOutboxHealth } from "@/lib/outbox";
import { requireSuperAdminMfa } from "@/lib/permissions";
import { storageConfigured } from "@/lib/storage";
import { isRedisConfigured } from "@/lib/redis";

export const metadata = { title: "Overview" };

export default async function AdminOverviewPage() {
  await requireSuperAdminMfa();
  const [users, workspaces, outbox] = await Promise.all([
    prisma.user.count(),
    prisma.workspace.count({ where: { archivedAt: null } }),
    getOutboxHealth(),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Instance admin" description="Operations for this Space Works instance. Workspace content stays private to members." />
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Users" value={users} href="/admin/users" />
        <StatTile label="Workspaces" value={workspaces} href="/admin/workspaces" />
        <StatTile label="Emails waiting" value={outbox.counts.PENDING} href="/admin/outbox" />
        <StatTile label="Emails failed" value={outbox.counts.FAILED} tone={outbox.counts.FAILED > 0 ? "attention" : "default"} href="/admin/outbox" />
      </section>
      <Card>
        <CardHeader title="Services" />
        <ul className="flex flex-col gap-2 text-body-ui text-ink">
          <li>Redis: {isRedisConfigured() ? "configured" : "not configured (rate limits and realtime use this process only)"}</li>
          <li>Object storage: {storageConfigured() ? "configured" : "not configured (development disk fallback)"}</li>
          <li>
            Email, Google sign-in and the assistant key: <Link href="/admin/settings" className="font-semibold underline underline-offset-4">instance settings</Link>
          </li>
        </ul>
      </Card>
    </div>
  );
}
