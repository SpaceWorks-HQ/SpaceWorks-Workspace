import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { loadControlsView } from "@/lib/moneyControls/queries";
import { ControlsScreen } from "@/components/moneyControls/Screen";
import {
  SECTIONS,
  type Section,
  type ControlsQuery,
} from "@/lib/moneyControls/rules";
export const metadata = { title: "Money and asset controls" };
export default async function Page({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/money-controls/[section]">) {
  const { workspaceSlug, section } = await params;
  const actor = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!Object.hasOwn(SECTIONS, section)) notFound();
  const raw = await searchParams,
    query = Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
    );
  const view = await loadControlsView(
    actor,
    section as Section,
    query as ControlsQuery,
    query.edit,
    query.new,
  );
  return <ControlsScreen view={view} />;
}
