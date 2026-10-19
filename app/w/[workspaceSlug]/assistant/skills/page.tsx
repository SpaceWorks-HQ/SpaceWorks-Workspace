import { SkillsManager } from "@/components/assistant/SkillsManager";
import { prisma } from "@/lib/db";
import { requireWorkspace } from "@/lib/permissions";
import { BUILTIN_SKILLS } from "@/lib/assistant/skills";

export const metadata = { title: "Assistant skills" };

export default async function AssistantSkillsPage({ params }: PageProps<"/w/[workspaceSlug]/assistant/skills">) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireWorkspace(workspaceSlug, "ADMIN");
  const skills = await prisma.assistantSkill.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { name: "asc" },
    select: { id: true, name: true, description: true, body: true, enabled: true },
  });
  const names = new Set(skills.map((s) => s.name.toLowerCase()));
  const missingBuiltins = BUILTIN_SKILLS.filter((skill) => !names.has(skill.name.toLowerCase())).map((skill) => skill.name);
  return <SkillsManager slug={workspace.slug} skills={skills} missingBuiltins={missingBuiltins} />;
}
