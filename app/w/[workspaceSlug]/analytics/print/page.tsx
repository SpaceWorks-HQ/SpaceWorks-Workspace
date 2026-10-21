import "./report.css";
import { requireWorkspace } from "@/lib/permissions";
import { packData } from "@/lib/analytics/packs";
import { context } from "@/lib/analytics/queries";
import { ReportPack } from "@/components/analytics/ReportPack";
export default async function AnalyticsPrintPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/analytics/print">) {
  const { workspaceSlug } = await params,
    actor = await requireWorkspace(workspaceSlug, "ADMIN"),
    q = await searchParams;
  const id = typeof q.preset === "string" ? q.preset : "",
    kind = q.kind === "board" ? "board" : "management";
  const data = await packData(actor, id, kind),
    period = (await context(actor, data.q)).p;
  return <ReportPack data={{ ...data, period }} />;
}
