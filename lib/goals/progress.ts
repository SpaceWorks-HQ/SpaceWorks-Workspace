export type ResultProgress = {
  metricType: string;
  start: number;
  target: number;
  current: number;
};

export function resultProgress(result: ResultProgress): number {
  if (result.metricType === "BOOLEAN") return result.current >= 1 ? 100 : 0;
  if (result.target === result.start)
    return result.current === result.target ? 100 : 0;
  return Math.max(
    0,
    Math.min(
      100,
      ((result.current - result.start) / (result.target - result.start)) * 100,
    ),
  );
}

/** Each direct key result and child objective has equal weight. */
export function goalRollup(
  results: ResultProgress[],
  children: number[] = [],
): number {
  const values = [...results.map(resultProgress), ...children];
  return values.length
    ? Math.round(values.reduce((sum, n) => sum + n, 0) / values.length)
    : 0;
}
