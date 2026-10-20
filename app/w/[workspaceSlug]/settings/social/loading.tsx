import { Skeleton } from "@/components/ui/display";
export default function Loading() { return <div role="status" aria-label="Loading social" className="space-y-4"><Skeleton className="h-12 w-40" /><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /><span className="sr-only">Loading social accounts and comments.</span></div>; }
