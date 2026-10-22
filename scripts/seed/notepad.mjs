import { randomUUID } from "node:crypto";

/** Private notes and to-dos for the demo owner; notes stay visible only to their author. */
export default async function seedNotepad(prisma, { workspaceId, users }) {
  if (process.env.NODE_ENV === "production") throw new Error("Demo seeds are for local development only.");
  const owner = users.owner ?? Object.values(users)[0];
  const day = (offset) => {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() + offset);
    return date;
  };
  await prisma.personalTodo.deleteMany({ where: { workspaceId, userId: owner.id } });
  await prisma.personalNote.deleteMany({ where: { workspaceId, userId: owner.id } });
  const notes = [
    { title: "Board meeting prep", tone: "CITRON", pinned: true, text: "Bring the Q2 utilisation figures, the rent renewal draft and the volunteer hours summary." },
    { title: "Grant ideas", tone: "SKY", pinned: false, text: "Solar workshop for the community hall. Ask the CSR partner about a matched contribution." },
    { title: "Things to fix at the space", tone: "YELLOW", pinned: false, text: "Second-floor extinguisher service is due. Wi-Fi drops near the laser corner." },
  ];
  for (const note of notes) {
    await prisma.personalNote.create({
      data: {
        id: randomUUID(), workspaceId, userId: owner.id, title: note.title, tone: note.tone, pinned: note.pinned,
        contentHtml: `<p>${note.text}</p>`, contentText: note.text,
      },
    });
  }
  const todos = [
    { text: "Send the August donor receipts", dueOn: day(0), starred: true },
    { text: "Confirm the rent cheque with the landlord", dueOn: day(1), starred: false },
    { text: "Review the BOM estimate for the solar workshop", dueOn: day(2), starred: true },
    { text: "Upload the PF challan", dueOn: day(5), starred: false },
    { text: "Thank the build night volunteers", dueOn: null, starred: false, done: true },
  ];
  for (const [index, todo] of todos.entries()) {
    await prisma.personalTodo.create({
      data: {
        id: randomUUID(), workspaceId, userId: owner.id, text: todo.text, dueOn: todo.dueOn, starred: todo.starred,
        done: Boolean(todo.done), doneAt: todo.done ? new Date() : null, position: (index + 1) * 1024,
      },
    });
  }
}
