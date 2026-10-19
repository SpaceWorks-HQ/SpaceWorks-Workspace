export function importSummary(stats: unknown) {
  const raw =
    stats && typeof stats === "object" && !Array.isArray(stats)
      ? (stats as Record<string, unknown>)
      : {};
  const count = (key: string) =>
    typeof raw[key] === "number" && Number.isFinite(raw[key])
      ? Math.max(0, Number(raw[key]))
      : 0;
  const errors = Array.isArray(raw.errors)
    ? raw.errors
        .flatMap((value) => {
          if (!value || typeof value !== "object" || Array.isArray(value))
            return [];
          const entry = value as Record<string, unknown>;
          return typeof entry.error === "string"
            ? [
                {
                  row: typeof entry.row === "number" ? entry.row : 0,
                  error: entry.error.slice(0, 300),
                },
              ]
            : [];
        })
        .slice(0, 50)
    : [];
  return {
    total: count("total"),
    valid: count("valid"),
    created: count("created"),
    skipped: count("skipped"),
    errors,
  };
}
