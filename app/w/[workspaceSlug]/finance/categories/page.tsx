import { notFound } from "next/navigation";
import { CategoryManager } from "@/components/finance/CategoryManager";
import { SectionHeading } from "@/components/ui/display";
import { listCategories } from "@/lib/finance/queries";
import { canManageFinance, requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Finance categories" };

export default async function FinanceCategoriesPage({ params }: PageProps<"/w/[workspaceSlug]/finance/categories">) {
  const { workspaceSlug } = await params;
  const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN");
  if (!canManageFinance(membership)) notFound();
  const categories = await listCategories(workspace.id, { includeArchived: true });
  return (
    <div className="flex flex-col gap-5">
      <SectionHeading title="Categories" description="Archived categories stay on old entries but can't be picked for new ones." />
      <CategoryManager slug={workspace.slug} categories={categories} />
    </div>
  );
}
