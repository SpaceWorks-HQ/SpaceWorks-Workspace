import Link from "next/link";
import { notFound } from "next/navigation";
import { ImportLedger } from "@/components/finance/ImportLedger";
import { SectionHeading } from "@/components/ui/display";
import { canManageFinance, requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Import ledger" };

export default async function ImportLedgerPage({ params }: PageProps<"/w/[workspaceSlug]/finance/ledger/import">) {
  const { workspaceSlug } = await params;
  const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN");
  if (!canManageFinance(membership)) notFound();
  const ledgerHref = `/w/${workspace.slug}/finance/ledger`;
  return (
    <div className="flex flex-col gap-5">
      <Link href={ledgerHref} className="text-label text-ink-secondary underline-offset-4 hover:underline">
        ← Back to the ledger
      </Link>
      <SectionHeading title="Import entries" description="Bring in last year's spreadsheet or a bank export. Every row is checked before anything is saved." />
      <ImportLedger slug={workspace.slug} currency={workspace.currency} ledgerHref={ledgerHref} />
    </div>
  );
}
