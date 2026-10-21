-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "blockerOwnerId" TEXT,
ADD COLUMN     "blockerReason" TEXT,
ADD COLUMN     "startsOn" DATE;

-- CreateTable
CREATE TABLE "ProjectMilestone" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetOn" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMilestoneTask" (
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,

    CONSTRAINT "ProjectMilestoneTask_pkey" PRIMARY KEY ("workspaceId","milestoneId","taskId")
);

-- CreateTable
CREATE TABLE "ProjectStatusUpdate" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "blockers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "nextSteps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectStatusUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectMilestone_workspaceId_projectId_targetOn_idx" ON "ProjectMilestone"("workspaceId", "projectId", "targetOn");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMilestone_workspaceId_projectId_id_key" ON "ProjectMilestone"("workspaceId", "projectId", "id");

-- CreateIndex
CREATE INDEX "ProjectMilestoneTask_workspaceId_taskId_idx" ON "ProjectMilestoneTask"("workspaceId", "taskId");

-- CreateIndex
CREATE INDEX "ProjectStatusUpdate_workspaceId_projectId_createdAt_idx" ON "ProjectStatusUpdate"("workspaceId", "projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Project_workspaceId_id_key" ON "Project"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "Task_workspaceId_blockerOwnerId_idx" ON "Task"("workspaceId", "blockerOwnerId");

-- CreateIndex
CREATE UNIQUE INDEX "Task_workspaceId_projectId_id_key" ON "Task"("workspaceId", "projectId", "id");

-- AddForeignKey
ALTER TABLE "ProjectMilestone" ADD CONSTRAINT "ProjectMilestone_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMilestone" ADD CONSTRAINT "ProjectMilestone_workspaceId_projectId_fkey" FOREIGN KEY ("workspaceId", "projectId") REFERENCES "Project"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMilestoneTask" ADD CONSTRAINT "ProjectMilestoneTask_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMilestoneTask" ADD CONSTRAINT "ProjectMilestoneTask_workspaceId_projectId_milestoneId_fkey" FOREIGN KEY ("workspaceId", "projectId", "milestoneId") REFERENCES "ProjectMilestone"("workspaceId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMilestoneTask" ADD CONSTRAINT "ProjectMilestoneTask_workspaceId_projectId_taskId_fkey" FOREIGN KEY ("workspaceId", "projectId", "taskId") REFERENCES "Task"("workspaceId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectStatusUpdate" ADD CONSTRAINT "ProjectStatusUpdate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectStatusUpdate" ADD CONSTRAINT "ProjectStatusUpdate_workspaceId_projectId_fkey" FOREIGN KEY ("workspaceId", "projectId") REFERENCES "Project"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

