-- CreateEnum
CREATE TYPE "NoteTone" AS ENUM ('PLAIN', 'CITRON', 'SKY', 'YELLOW', 'ORANGE', 'TEAL');

-- CreateTable
CREATE TABLE "PersonalNote" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "contentHtml" TEXT NOT NULL DEFAULT '',
    "contentText" TEXT NOT NULL DEFAULT '',
    "tone" "NoteTone" NOT NULL DEFAULT 'PLAIN',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalTodo" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "doneAt" TIMESTAMP(3),
    "dueOn" DATE,
    "starred" BOOLEAN NOT NULL DEFAULT false,
    "position" DOUBLE PRECISION NOT NULL,
    "noteId" TEXT,
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalTodo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonalNote_workspaceId_userId_archivedAt_pinned_updatedAt_idx" ON "PersonalNote"("workspaceId", "userId", "archivedAt", "pinned", "updatedAt");

-- CreateIndex
CREATE INDEX "PersonalTodo_workspaceId_userId_done_position_idx" ON "PersonalTodo"("workspaceId", "userId", "done", "position");

-- CreateIndex
CREATE INDEX "PersonalTodo_noteId_idx" ON "PersonalTodo"("noteId");

-- AddForeignKey
ALTER TABLE "PersonalNote" ADD CONSTRAINT "PersonalNote_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalNote" ADD CONSTRAINT "PersonalNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalTodo" ADD CONSTRAINT "PersonalTodo_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalTodo" ADD CONSTRAINT "PersonalTodo_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalTodo" ADD CONSTRAINT "PersonalTodo_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "PersonalNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
