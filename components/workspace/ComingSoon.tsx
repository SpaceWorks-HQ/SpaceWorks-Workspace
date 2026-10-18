import { PageHeader, EmptyState } from "@/components/ui/display";

/**
 * Shared placeholder for product areas that are routed and in the nav but not
 * built yet. Each later build replaces its own page file.
 */
export function ComingSoon({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} description={description} />
      <EmptyState mood="thinking" title="Coming in the next build.">
        This part of the workspace is on its way.
      </EmptyState>
    </div>
  );
}
