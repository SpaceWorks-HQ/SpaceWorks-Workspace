export default function Loading() {
  return <div role="status" aria-live="polite" className="space-y-4"><h1 className="text-h1">Services</h1><p className="text-body-ui text-ink-muted">Loading service health…</p><div aria-hidden="true" className="grid gap-4 sm:grid-cols-2">{[1, 2, 3, 4].map(n => <div key={n} className="h-40 rounded-xl border border-line bg-panel motion-safe:animate-pulse" />)}</div></div>;
}
