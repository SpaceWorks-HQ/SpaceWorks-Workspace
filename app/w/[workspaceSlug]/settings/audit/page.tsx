import { EmptyState } from "@/components/ui/display";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { listAuditEvents } from "@/lib/audit";
import { formatDayTime } from "@/lib/format/datetime";
import { requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Audit log" };

function describeMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "";
  return Object.entries(metadata as Record<string, unknown>).map(([key, value]) => `${key}: ${String(value)}`).join(", ");
}

export default async function AuditLogPage({ params }: PageProps<"/w/[workspaceSlug]/settings/audit">) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireWorkspace(workspaceSlug, "ADMIN");
  const events = await listAuditEvents(workspace.id, { take: 200 });
  if (events.length === 0) return <EmptyState title="Nothing recorded yet.">Changes to members, invitations and settings appear here.</EmptyState>;
  return (
    <Table label="Audit log">
      <THead>
        <tr>
          <TH>When</TH>
          <TH>Who</TH>
          <TH>What</TH>
          <TH>Details</TH>
        </tr>
      </THead>
      <TBody>
        {events.map((event) => (
          <TR key={event.id}>
            <TD className="whitespace-nowrap tabular-nums text-ink-muted">{formatDayTime(event.createdAt, workspace.timezone)}</TD>
            <TD className="whitespace-nowrap">{event.actor?.name ?? event.actor?.email ?? (event.actorApiToken ? `API token ${event.actorApiToken.name}` : "System")}</TD>
            <TD className="whitespace-nowrap font-semibold">{event.action}</TD>
            <TD className="text-caption text-ink-muted">{[event.targetType, describeMetadata(event.metadata)].filter(Boolean).join(" · ")}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
