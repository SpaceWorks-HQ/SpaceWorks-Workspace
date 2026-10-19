export type Ballot = { choice: unknown };
export type PollTally = {
  counts: Record<string, number>;
  ballots: number;
  winners: string[];
  rounds: Record<string, number>[];
  quorumMet: boolean;
};

export function tallyPoll(
  type: string,
  optionIds: string[],
  ballots: Ballot[],
  quorum: { count?: number; percent?: number } | null = null,
  eligibleCount = 0,
): PollTally {
  const counts = Object.fromEntries(optionIds.map((id) => [id, 0]));
  const choices = ballots.map((b) =>
    Array.isArray(b.choice)
      ? b.choice.filter(
          (id): id is string =>
            typeof id === "string" && optionIds.includes(id),
        )
      : [],
  );
  const rounds: Record<string, number>[] = [];
  let winners: string[] = [];
  if (type === "RANKED") {
    let remaining = [...optionIds];
    while (remaining.length) {
      const round = Object.fromEntries(remaining.map((id) => [id, 0]));
      for (const choice of choices) {
        const first = choice.find((id) => remaining.includes(id));
        if (first) round[first]++;
      }
      rounds.push(round);
      if (rounds.length === 1) Object.assign(counts, round);
      const total = Object.values(round).reduce((a, b) => a + b, 0);
      if (!total) break;
      const max = Math.max(...Object.values(round));
      if (max > total / 2) {
        winners = remaining.filter((id) => round[id] === max);
        break;
      }
      const min = Math.min(...Object.values(round));
      if (min === max) {
        winners = remaining;
        break;
      }
      // Eliminate one lowest candidate in stable option order; ties remain reproducible.
      const eliminated = remaining.find((id) => round[id] === min)!;
      remaining = remaining.filter((id) => id !== eliminated);
    }
  } else {
    for (const choice of choices)
      for (const id of new Set(choice)) counts[id]++;
    const max = Math.max(0, ...Object.values(counts));
    winners = max ? optionIds.filter((id) => counts[id] === max) : [];
  }
  const needed =
    quorum?.count ??
    (quorum?.percent ? Math.ceil((eligibleCount * quorum.percent) / 100) : 0);
  return {
    counts,
    ballots: ballots.length,
    winners,
    rounds,
    quorumMet: ballots.length >= needed,
  };
}

/** Never put receipts, identities, ballot timestamps or individual choices in a results DTO. */
export function resultsVisible(
  visibility: string,
  closedAt: Date | null,
  closesAt: Date | null,
  now = new Date(),
) {
  return visibility === "LIVE" || !!closedAt || (!!closesAt && closesAt <= now);
}
