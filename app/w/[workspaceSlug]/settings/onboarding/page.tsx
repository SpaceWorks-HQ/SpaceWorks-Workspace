import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canManageOnboarding } from "@/lib/roles";
import { checklistTemplates } from "@/lib/people/onboarding";
import { listTeams } from "@/lib/teams/teams";
import { listMembers } from "@/lib/people/profiles";
import { Card, CardHeader, PageHeader } from "@/components/ui/display";
import { TemplateEditor } from "@/components/people/TemplateEditor";
export const metadata = { title: "Onboarding templates" };
export default async function TemplatesPage({ params }: PageProps<"/w/[workspaceSlug]/settings/onboarding">) {
  const { workspaceSlug } = await params; const ctx = await requireWorkspace(workspaceSlug, "ADMIN"); if (!canManageOnboarding(ctx.membership)) notFound(); const [templates, teams, members] = await Promise.all([checklistTemplates(ctx), listTeams(ctx), listMembers(ctx)]);
  return <div className="flex max-w-3xl flex-col gap-6"><PageHeader titleAs="h2" title="Onboarding templates" description="Checklists for joining, leaving and everyday handovers." />{templates.map(t => <Card key={t.id}><details><summary className="min-h-11 cursor-pointer text-title">{t.name}</summary><TemplateEditor slug={workspaceSlug} teams={teams.map(t => ({ id: t.id, name: t.name }))} members={members.map(m => ({ id: m.id, name: m.name }))} template={t} /></details></Card>)}<Card><CardHeader title="New template" /><TemplateEditor slug={workspaceSlug} teams={teams.map(t => ({ id: t.id, name: t.name }))} members={members.map(m => ({ id: m.id, name: m.name }))} /></Card></div>;
}
