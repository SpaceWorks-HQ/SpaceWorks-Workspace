-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "GovernanceKind" ADD VALUE 'INSURANCE';
ALTER TYPE "GovernanceKind" ADD VALUE 'LICENCE';
ALTER TYPE "GovernanceKind" ADD VALUE 'REGISTRATION';
ALTER TYPE "GovernanceKind" ADD VALUE 'STATUTORY_REGISTER';
ALTER TYPE "GovernanceKind" ADD VALUE 'RISK';
ALTER TYPE "GovernanceKind" ADD VALUE 'EMERGENCY_PLAN';
ALTER TYPE "GovernanceKind" ADD VALUE 'DRILL';
ALTER TYPE "GovernanceKind" ADD VALUE 'SOP_REVIEW';
ALTER TYPE "GovernanceKind" ADD VALUE 'BOARD_PACK';

-- CreateTable
CREATE TABLE "SafeguardingHandler" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "committeeId" TEXT NOT NULL,
    "appointedById" TEXT NOT NULL,
    "endsOn" DATE NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SafeguardingHandler_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafeguardingCase" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "handlerIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "receivedOn" DATE NOT NULL,
    "dueOn" DATE NOT NULL,
    "detailsEnc" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "SafeguardingCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafeguardingEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "bodyEnc" TEXT NOT NULL,
    "ownerId" TEXT,
    "dueOn" DATE,
    "completedAt" TIMESTAMP(3),
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SafeguardingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafeguardingAttachment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SafeguardingAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SafeguardingHandler_workspaceId_committeeId_revokedAt_idx" ON "SafeguardingHandler"("workspaceId", "committeeId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SafeguardingHandler_workspaceId_userId_key" ON "SafeguardingHandler"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "SafeguardingCase_workspaceId_status_dueOn_idx" ON "SafeguardingCase"("workspaceId", "status", "dueOn");

-- CreateIndex
CREATE UNIQUE INDEX "SafeguardingCase_workspaceId_id_key" ON "SafeguardingCase"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SafeguardingCase_workspaceId_number_key" ON "SafeguardingCase"("workspaceId", "number");

-- CreateIndex
CREATE INDEX "SafeguardingEvent_workspaceId_caseId_createdAt_idx" ON "SafeguardingEvent"("workspaceId", "caseId", "createdAt");

-- CreateIndex
CREATE INDEX "SafeguardingAttachment_workspaceId_caseId_idx" ON "SafeguardingAttachment"("workspaceId", "caseId");

-- CreateIndex
CREATE UNIQUE INDEX "SafeguardingAttachment_workspaceId_fileId_key" ON "SafeguardingAttachment"("workspaceId", "fileId");

-- AddForeignKey
ALTER TABLE "SafeguardingHandler" ADD CONSTRAINT "SafeguardingHandler_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafeguardingCase" ADD CONSTRAINT "SafeguardingCase_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafeguardingEvent" ADD CONSTRAINT "SafeguardingEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafeguardingEvent" ADD CONSTRAINT "SafeguardingEvent_workspaceId_caseId_fkey" FOREIGN KEY ("workspaceId", "caseId") REFERENCES "SafeguardingCase"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafeguardingAttachment" ADD CONSTRAINT "SafeguardingAttachment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafeguardingAttachment" ADD CONSTRAINT "SafeguardingAttachment_workspaceId_caseId_fkey" FOREIGN KEY ("workspaceId", "caseId") REFERENCES "SafeguardingCase"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafeguardingAttachment" ADD CONSTRAINT "SafeguardingAttachment_workspaceId_fileId_fkey" FOREIGN KEY ("workspaceId", "fileId") REFERENCES "FileObject"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
