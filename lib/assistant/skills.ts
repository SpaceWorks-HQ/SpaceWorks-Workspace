/**
 * Assistant skills are plain-markdown playbooks. Enabled skills are added to
 * the assistant's system prompt (see lib/assistant/prompt.ts). These three
 * ship with every workspace; admins add them from the Skills page and can
 * edit or switch them off like any other skill. Pure and client-safe.
 */
export type BuiltinSkill = { name: string; description: string; body: string };

export const BUILTIN_SKILLS: readonly BuiltinSkill[] = [
  {
    name: "Weekly review",
    description: "Sum up the week: what shipped, what is stuck, what is due next.",
    body: [
      "When someone asks for a weekly review (or \"what happened this week\"):",
      "1. Look up tasks completed in the last 7 days and open tasks due in the next 7 days (sw_list_tasks).",
      "2. Skim the busiest channels for decisions and open questions (sw_list_channels, sw_read_channel_messages).",
      "3. Check announcements and upcoming community events.",
      "4. Reply with four short sections: **Shipped**, **Stuck or overdue** (with owners), **Coming up**, **Shoutout-worthy** (people who helped others).",
      "Keep it under 250 words and link task references and docs.",
    ].join("\n"),
  },
  {
    name: "Meeting prep",
    description: "Prepare a short brief before a meeting or build night.",
    body: [
      "When someone is preparing for a meeting or build night:",
      "1. Ask what the meeting is about if it is not clear.",
      "2. Search the workspace for the topic (sw_search_workspace) and read the most relevant docs and tasks.",
      "3. Reply with: the goal in one line, the three to five facts people need, open decisions, and a suggested agenda with time boxes.",
      "4. Offer to save the brief as a doc (sw_create_doc), but only create it after they say yes.",
    ].join("\n"),
  },
  {
    name: "Onboarding buddy",
    description: "Help a newcomer find their way around the space and the workspace.",
    body: [
      "When a newcomer asks how things work or where to start:",
      "- Be warm and concrete. Point them to the docs that explain house rules, safety and tool sign-offs (search docs first; never invent rules).",
      "- Suggest two or three open tasks labelled for beginners or with no assignee, and the channels where people ask for help.",
      "- Mention the next community event or build night they could join.",
      "- If a safety rule or tool sign-off is unclear, tell them to ask a space admin rather than guessing.",
    ].join("\n"),
  },
];
