import { notFound } from "next/navigation";
import { requireWorkspace, canManageFinance } from "@/lib/permissions";
import { financePickers } from "@/lib/finance/tools/queries";
import { getAssistantConfig } from "@/lib/assistant/client";
import { localDate } from "@/lib/finance/dates";
import { ReceiptEntry } from "@/components/finance/ReceiptEntry";
export default async function Page({
  params,
}: PageProps<"/w/[workspaceSlug]/finance/receipt">) {
  const { workspaceSlug } = await params;
  const actor = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!canManageFinance(actor.membership)) notFound();
  const [pickers, config] = await Promise.all([
    financePickers(actor),
    getAssistantConfig(),
  ]);
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <h2 className="text-h2">Add an entry</h2>
      <ReceiptEntry
        slug={actor.workspace.slug}
        pickers={pickers}
        currency={actor.workspace.currency}
        today={localDate(new Date(), actor.workspace.timezone)}
        configured={!!config}
      />
    </div>
  );
}
