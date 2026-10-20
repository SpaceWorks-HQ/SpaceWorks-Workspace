/** Manual planning for two internal community-office projects. Safe to run again. */
export default async function seedProjectsPlus(prisma, { workspaceId, workspace, users }) {
  const day = offset => {
    const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); d.setUTCHours(0, 0, 0, 0); return d;
  };
  for (const [key, name, owner, titles] of [
    ["HND", "Kochi office handover", users.admin, ["Check the keys and office inventory", "Write the volunteer handover notes", "Review the handover with the crew"]],
    ["RPT", "Annual community report", users.meera, ["Collect programme summaries", "Review the impact figures", "Share the internal report draft"]],
  ]) {
    await prisma.$transaction(async tx => {
      if (await tx.project.findUnique({ where: { workspaceId_key: { workspaceId, key } } })) return;
      const project = await tx.project.create({ data: { workspaceId, key, name, ownerId: owner.id, startsOn: day(-14), dueOn: day(14), description: "A simple internal plan for the Space Works office team.", createdAt: day(-14) } });
      const columns = await Promise.all(["To do", "In progress", "Done"].map((name, position) => tx.boardColumn.create({ data: { projectId: project.id, name, category: ["TODO", "IN_PROGRESS", "DONE"][position], position } })));
      const tasks = [];
      for (const [i, title] of titles.entries()) {
        const [counter] = await tx.$queryRaw`INSERT INTO "WorkspaceCounter" ("workspaceId",name,value) VALUES (${workspaceId},'task',1) ON CONFLICT ("workspaceId",name) DO UPDATE SET value="WorkspaceCounter".value+1 RETURNING value`;
        const task = await tx.task.create({ data: { workspaceId, projectId: project.id, number: counter.value, title, creatorId: owner.id, startsOn: day(-10 + i * 4), dueAt: day(i === 1 ? -2 : 5 + i * 3), columnId: columns[i === 0 ? 2 : 0].id, position: (i + 1) * 1024, completedAt: i === 0 ? day(-5) : null, blockerReason: i === 1 ? "Waiting for the team to confirm the figures and notes." : null, blockerOwnerId: i === 1 ? owner.id : null, assignees: { create: { userId: owner.id } } } });
        tasks.push(task);
        await tx.searchDocument.create({ data: { workspaceId, entityType: "task", entityId: task.id, projectId: project.id, title: `${key}-${task.number} ${title}`, body: task.blockerReason ?? "", url: `/w/${workspace.slug}/projects/${key}/${task.number}` } });
      }
      await tx.taskDependency.create({ data: { workspaceId, blockingTaskId: tasks[1].id, blockedTaskId: tasks[2].id, createdById: owner.id } });
      for (const [i, title] of ["First review ready", "Team sign-off"].entries()) {
        const m = await tx.projectMilestone.create({ data: { workspaceId, projectId: project.id, name: title, targetOn: day(i ? 14 : 3), status: "PENDING", notes: i ? "Confirm the final notes at the weekly team meeting." : "Review the first completed step together.", createdById: owner.id } });
        await tx.projectMilestoneTask.create({ data: { workspaceId, projectId: project.id, milestoneId: m.id, taskId: tasks[i ? 2 : 0].id } });
        await tx.searchDocument.create({ data: { workspaceId, entityType: "project_milestone", entityId: m.id, projectId: project.id, title, body: m.notes, url: `/w/${workspace.slug}/projects/${key}/overview` } });
      }
      const u = await tx.projectStatusUpdate.create({ data: { workspaceId, projectId: project.id, authorId: owner.id, status: key === "RPT" ? "AT_RISK" : "ON_TRACK", note: "The first review is complete. We are collecting the remaining notes from the Kochi office crew.", blockers: ["Two team confirmations are pending."], nextSteps: ["Follow up with the owners.", "Review the draft at Friday's meeting."], createdAt: day(-8) } });
      await tx.searchDocument.create({ data: { workspaceId, entityType: "project_update", entityId: u.id, projectId: project.id, title: `${name}: weekly update`, body: u.note, url: `/w/${workspace.slug}/projects/${key}/updates` } });
      await tx.searchDocument.create({ data: { workspaceId, entityType: "project", entityId: project.id, projectId: project.id, title: name, body: project.description, url: `/w/${workspace.slug}/projects/${key}` } });
    });
  }
}
