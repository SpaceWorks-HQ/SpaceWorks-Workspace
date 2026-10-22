-- AlterTable
ALTER TABLE "MemberProfile" ADD COLUMN     "contactHandle" TEXT,
ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "contactVisibility" "Visibility" NOT NULL DEFAULT 'PRIVATE',
ADD COLUMN     "departmentId" TEXT,
ADD COLUMN     "managerId" TEXT;

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "headId" TEXT,
    "parentId" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Responsibility" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "responsibleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "accountableId" TEXT NOT NULL,
    "consultedIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "informedIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "backupId" TEXT,
    "reviewOn" DATE NOT NULL,
    "reminderDays" INTEGER NOT NULL DEFAULT 7,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Responsibility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceEntry" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dateOn" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgEscalationPath" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "hoursNote" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "steps" JSONB NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgEscalationPath_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgPeopleAttachment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgPeopleAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Department_workspaceId_parentId_idx" ON "Department"("workspaceId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Department_workspaceId_id_key" ON "Department"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Department_workspaceId_name_key" ON "Department"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "Responsibility_workspaceId_status_reviewOn_idx" ON "Responsibility"("workspaceId", "status", "reviewOn");

-- CreateIndex
CREATE INDEX "Responsibility_workspaceId_accountableId_idx" ON "Responsibility"("workspaceId", "accountableId");

-- CreateIndex
CREATE INDEX "AttendanceEntry_workspaceId_dateOn_idx" ON "AttendanceEntry"("workspaceId", "dateOn");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceEntry_workspaceId_userId_dateOn_key" ON "AttendanceEntry"("workspaceId", "userId", "dateOn");

-- CreateIndex
CREATE INDEX "OrgEscalationPath_workspaceId_active_idx" ON "OrgEscalationPath"("workspaceId", "active");

-- CreateIndex
CREATE INDEX "OrgPeopleAttachment_workspaceId_kind_recordId_idx" ON "OrgPeopleAttachment"("workspaceId", "kind", "recordId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgPeopleAttachment_workspaceId_fileId_key" ON "OrgPeopleAttachment"("workspaceId", "fileId");

-- CreateIndex
CREATE INDEX "MemberProfile_workspaceId_departmentId_idx" ON "MemberProfile"("workspaceId", "departmentId");

-- CreateIndex
CREATE INDEX "MemberProfile_workspaceId_managerId_idx" ON "MemberProfile"("workspaceId", "managerId");

-- AddForeignKey
ALTER TABLE "MemberProfile" ADD CONSTRAINT "MemberProfile_workspaceId_departmentId_fkey" FOREIGN KEY ("workspaceId", "departmentId") REFERENCES "Department"("workspaceId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_workspaceId_parentId_fkey" FOREIGN KEY ("workspaceId", "parentId") REFERENCES "Department"("workspaceId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Responsibility" ADD CONSTRAINT "Responsibility_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceEntry" ADD CONSTRAINT "AttendanceEntry_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgEscalationPath" ADD CONSTRAINT "OrgEscalationPath_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgPeopleAttachment" ADD CONSTRAINT "OrgPeopleAttachment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgPeopleAttachment" ADD CONSTRAINT "OrgPeopleAttachment_workspaceId_fileId_fkey" FOREIGN KEY ("workspaceId", "fileId") REFERENCES "FileObject"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

