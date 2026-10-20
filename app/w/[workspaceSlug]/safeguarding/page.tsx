import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { loadCases } from "@/lib/govextras/cases";
import { CaseScreen } from "@/components/govextras/CaseScreen";
import { GovernanceError } from "@/lib/governance/service";
export const metadata = { title: "Confidential safeguarding" };
export default async function Page({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/safeguarding">) {
  const { workspaceSlug } = await params;
  const actor = await requireWorkspace(workspaceSlug, "MEMBER");
  const query = await searchParams;
  const filters = Object.fromEntries(
    Object.entries(query).map(([k, v]) => [
      k,
      typeof v === "string" ? v : undefined,
    ]),
  );
  const data = await loadCases(
    actor,
    filters,
    typeof query.edit === "string" ? query.edit : undefined,
  ).catch((e) => {
    if (e instanceof GovernanceError) notFound();
    throw e;
  });
  return (
    <CaseScreen
      slug={workspaceSlug}
      timezone={actor.workspace.timezone}
      query={query}
      data={data}
    />
  );
}
