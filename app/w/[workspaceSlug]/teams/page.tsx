import Link from "next/link";
import { requireWorkspace } from "@/lib/permissions";
import { listTeams } from "@/lib/teams/teams";
import { canAdministerTeams } from "@/lib/people/access";
import { saveTeamAction } from "@/app/actions/teams";
import { Card, CardHeader, Chip, EmptyState, PageHeader } from "@/components/ui/display";
import { EditorForm } from "@/components/people/AreaForms";
export const metadata = { title: "Teams" };
export default async function TeamsPage({ params }: PageProps<"/w/[workspaceSlug]/teams">) {
  const { workspaceSlug } = await params; const ctx = await requireWorkspace(workspaceSlug, "GUEST"); const teams = await listTeams(ctx, { includeArchived: true });
  return <div className="flex flex-col gap-6"><PageHeader title="Teams" description="Crews inside the community, with their people and projects." /><div className="grid gap-4 sm:grid-cols-2">{teams.map(t => <Card key={t.id}><Link href={`/w/${workspaceSlug}/teams/${t.slug}`} className="text-title text-primary underline">{t.name}</Link><div className="my-3 flex flex-wrap gap-2"><Chip>{t.visibility === "PRIVATE" ? "Private" : "Public"}</Chip>{t.archivedAt ? <Chip tone="warning">Archived</Chip> : null}</div><p className="text-body-ui text-ink-secondary">{t.description}</p><p className="mt-3 text-caption text-ink-muted">{t.counts.members} members · {t.counts.projects} projects</p></Card>)}</div>{!teams.length ? <EmptyState title="No teams yet. Start a crew for the next build night." /> : null}{canAdministerTeams(ctx.membership) ? <Card className="max-w-2xl"><CardHeader title="Start a team" /><EditorForm action={saveTeamAction.bind(null, workspaceSlug, null)} label="Create team" resetOnSuccess fields={[{ name: "name", label: "Team name", required: true, maxLength: 60 }, { name: "description", label: "Description", type: "textarea", maxLength: 500 }, { name: "visibility", label: "Visibility", type: "select", value: "PUBLIC", options: [{ value: "PUBLIC", label: "Public — anyone can join" }, { value: "PRIVATE", label: "Private — invite only" }] }]} /></Card> : null}</div>;
}
