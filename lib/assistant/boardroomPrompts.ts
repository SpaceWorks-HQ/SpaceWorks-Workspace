/**
 * Boardroom: a panel of AI "seats" with personas debates a question over a
 * few rounds, then a moderator writes the recommendation and the dissent.
 * Prompt assembly is pure (unit-tested); lib/assistant/boardroom.ts runs it.
 */

export const PERSONA_PRESETS = [
  { name: "Treasurer", persona: "You look after the community kitty. You weigh cost, cash flow, value for money and what happens if it goes wrong financially. You like numbers and cheaper alternatives." },
  { name: "Safety lead", persona: "You are responsible for people and machines being safe. You think about training, sign-offs, supervision, fire, electrical and chemical risks, and insurance. You never wave risks away." },
  { name: "Newcomer", persona: "You joined the community a month ago. You notice jargon, hidden assumptions and anything that would make someone new feel unwelcome or lost. You ask the simple questions." },
  { name: "Skeptic", persona: "You stress-test ideas. You look for the weakest assumption, the missing evidence and the second-order effects, and you propose how to check them cheaply." },
  { name: "Maker", persona: "You build things every week. You care about what is practical to make, maintain and repair with the tools and time the space actually has. You suggest a small first prototype." },
] as const;

export type SeatInfo = { id: string; name: string; persona: string };
export type TurnInfo = { seatId: string | null; seatName: string; round: number; role: "SEAT" | "MODERATOR"; content: string };

export const MAX_TURN_WORDS = 180;

export function seatSystemPrompt(input: { workspaceName: string; seat: SeatInfo; seats: readonly SeatInfo[]; rounds: number }): string {
  const others = input.seats.filter((s) => s.id !== input.seat.id).map((s) => s.name);
  return [
    `You are "${input.seat.name}", one seat on the Boardroom panel of ${input.workspaceName}, a maker and hacker community.`,
    `Your perspective: ${input.seat.persona}`,
    `Other seats: ${others.length ? others.join(", ") : "none"}. The debate has ${input.rounds} round${input.rounds === 1 ? "" : "s"}.`,
    "Argue from your perspective honestly: agree where others are right, push back where they are not, and bring something new each round.",
    `Keep each turn under ${MAX_TURN_WORDS} words. Plain prose or a short list. Do not write anyone else's lines and do not summarise the whole debate.`,
  ].join("\n");
}

/** The user message for a seat's turn: the question plus the transcript so far. */
export function seatTurnMessage(input: { question: string; round: number; rounds: number; transcript: readonly TurnInfo[] }): string {
  const lines = [`Question for the panel:\n${input.question}`, ""];
  const previous = input.transcript.filter((t) => t.role === "SEAT");
  if (previous.length === 0) {
    lines.push(`Round ${input.round} of ${input.rounds}. You speak first. Give your opening position.`);
  } else {
    lines.push("Transcript so far:");
    for (const turn of previous) lines.push(`\n[Round ${turn.round}] ${turn.seatName}:\n${turn.content.trim()}`);
    lines.push("", `Round ${input.round} of ${input.rounds}. Your turn${input.round === input.rounds ? " (final round: state your closing position)" : ""}.`);
  }
  return lines.join("\n");
}

export function moderatorSystemPrompt(workspaceName: string): string {
  return [
    `You moderate the Boardroom panel of ${workspaceName}, a maker and hacker community.`,
    "Read the debate and write the outcome for the members who asked. Be fair to every seat and do not add new arguments of your own.",
    "Use exactly these markdown sections:",
    "## Recommendation (what to do, in two or three sentences)",
    "## Why (the strongest reasons, as a short list)",
    "## Dissent (who disagreed and why; write \"None\" if the panel agreed)",
    "## Next steps (two to four concrete actions)",
  ].join("\n");
}

export function moderatorMessage(input: { question: string; seats: readonly SeatInfo[]; transcript: readonly TurnInfo[] }): string {
  const lines = [`Question:\n${input.question}`, "", `Seats: ${input.seats.map((s) => s.name).join(", ")}`, "", "Debate:"];
  for (const turn of input.transcript.filter((t) => t.role === "SEAT")) lines.push(`\n[Round ${turn.round}] ${turn.seatName}:\n${turn.content.trim()}`);
  return lines.join("\n");
}

/** Markdown export of a finished session. */
export function boardroomMarkdown(input: { title: string; question: string; createdAt: Date; seats: readonly SeatInfo[]; transcript: readonly TurnInfo[]; summary: string | null }): string {
  const lines = [`# ${input.title}`, "", `_Boardroom session, ${input.createdAt.toISOString().slice(0, 10)}_`, "", "## Question", "", input.question, "", "## Panel", ""];
  for (const seat of input.seats) lines.push(`- **${seat.name}**: ${seat.persona}`);
  if (input.summary) lines.push("", "## Outcome", "", input.summary.trim());
  lines.push("", "## Transcript");
  let round = 0;
  for (const turn of input.transcript.filter((t) => t.role === "SEAT")) {
    if (turn.round !== round) {
      round = turn.round;
      lines.push("", `### Round ${round}`);
    }
    lines.push("", `**${turn.seatName}**`, "", turn.content.trim());
  }
  return `${lines.join("\n")}\n`;
}
