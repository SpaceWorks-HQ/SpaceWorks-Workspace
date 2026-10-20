import { Skeleton } from "@/components/ui/display";
export default function Loading() {
  return (
    <div
      className="space-y-4"
      aria-busy="true"
      aria-label="Loading team calendar"
    >
      <Skeleton className="h-10 w-60" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}
