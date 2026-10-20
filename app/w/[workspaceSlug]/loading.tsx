import { Patch } from "@/components/brand/Patch";

export default function Loading() {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 py-12 text-center" role="status">
      <Patch pose="walk" size={136} />
      <p className="text-body-ui text-ink-muted">Fetching that for you…</p>
    </div>
  );
}
