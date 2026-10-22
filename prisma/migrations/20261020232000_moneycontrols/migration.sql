-- CreateEnum
CREATE TYPE "MoneyControlKind" AS ENUM ('FLOAT', 'VOUCHER', 'COUNT', 'REPLENISHMENT', 'HANDOVER', 'DEPOSIT', 'TRANSFER', 'ASSET_CATEGORY', 'SCHEDULE', 'VERIFICATION', 'DISPOSAL', 'ASSIGNMENT', 'TDS_DEDUCTION', 'CERTIFICATE', 'FILING', 'FUND_RULE');

-- CreateTable
CREATE TABLE "MoneyControlRecord" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" "MoneyControlKind" NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "recordKey" TEXT,
    "number" INTEGER,
    "ownerId" TEXT,
    "accountId" TEXT,
    "otherAccountId" TEXT,
    "assetId" TEXT,
    "fundId" TEXT,
    "categoryId" TEXT,
    "parentId" TEXT,
    "complianceId" TEXT,
    "checklistRunId" TEXT,
    "amountMinor" INTEGER NOT NULL DEFAULT 0,
    "settledMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "occurredOn" DATE NOT NULL,
    "endsOn" DATE,
    "dueOn" DATE,
    "reminderDays" INTEGER NOT NULL DEFAULT 7,
    "payroll" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT NOT NULL DEFAULT '',
    "details" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MoneyControlRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoneyControlAttachment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoneyControlAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoneyControlMovement" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "occurredOn" DATE NOT NULL,
    "reference" TEXT NOT NULL,
    "operationKey" TEXT NOT NULL,
    "reconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoneyControlMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoneyControlEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reference" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoneyControlEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MoneyControlRecord_workspaceId_kind_occurredOn_idx" ON "MoneyControlRecord"("workspaceId", "kind", "occurredOn");

-- CreateIndex
CREATE INDEX "MoneyControlRecord_workspaceId_ownerId_status_dueOn_idx" ON "MoneyControlRecord"("workspaceId", "ownerId", "status", "dueOn");

-- CreateIndex
CREATE INDEX "MoneyControlRecord_workspaceId_assetId_kind_idx" ON "MoneyControlRecord"("workspaceId", "assetId", "kind");

-- CreateIndex
CREATE INDEX "MoneyControlRecord_workspaceId_fundId_kind_idx" ON "MoneyControlRecord"("workspaceId", "fundId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyControlRecord_workspaceId_id_key" ON "MoneyControlRecord"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyControlRecord_workspaceId_kind_recordKey_key" ON "MoneyControlRecord"("workspaceId", "kind", "recordKey");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyControlRecord_workspaceId_kind_number_key" ON "MoneyControlRecord"("workspaceId", "kind", "number");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyControlAttachment_fileId_key" ON "MoneyControlAttachment"("fileId");

-- CreateIndex
CREATE INDEX "MoneyControlAttachment_workspaceId_recordId_idx" ON "MoneyControlAttachment"("workspaceId", "recordId");

-- CreateIndex
CREATE INDEX "MoneyControlMovement_workspaceId_accountId_occurredOn_idx" ON "MoneyControlMovement"("workspaceId", "accountId", "occurredOn");

-- CreateIndex
CREATE INDEX "MoneyControlMovement_workspaceId_recordId_idx" ON "MoneyControlMovement"("workspaceId", "recordId");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyControlMovement_workspaceId_operationKey_accountId_key" ON "MoneyControlMovement"("workspaceId", "operationKey", "accountId");

-- CreateIndex
CREATE INDEX "MoneyControlEvent_workspaceId_recordId_createdAt_idx" ON "MoneyControlEvent"("workspaceId", "recordId", "createdAt");

-- AddForeignKey
ALTER TABLE "MoneyControlRecord" ADD CONSTRAINT "MoneyControlRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyControlRecord" ADD CONSTRAINT "MoneyControlRecord_workspaceId_parentId_fkey" FOREIGN KEY ("workspaceId", "parentId") REFERENCES "MoneyControlRecord"("workspaceId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyControlAttachment" ADD CONSTRAINT "MoneyControlAttachment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyControlAttachment" ADD CONSTRAINT "MoneyControlAttachment_workspaceId_recordId_fkey" FOREIGN KEY ("workspaceId", "recordId") REFERENCES "MoneyControlRecord"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyControlAttachment" ADD CONSTRAINT "MoneyControlAttachment_workspaceId_fileId_fkey" FOREIGN KEY ("workspaceId", "fileId") REFERENCES "FileObject"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyControlMovement" ADD CONSTRAINT "MoneyControlMovement_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyControlMovement" ADD CONSTRAINT "MoneyControlMovement_workspaceId_recordId_fkey" FOREIGN KEY ("workspaceId", "recordId") REFERENCES "MoneyControlRecord"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyControlEvent" ADD CONSTRAINT "MoneyControlEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyControlEvent" ADD CONSTRAINT "MoneyControlEvent_workspaceId_recordId_fkey" FOREIGN KEY ("workspaceId", "recordId") REFERENCES "MoneyControlRecord"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "MoneyControlRecord" ADD CONSTRAINT "MoneyControlRecord_amount_check" CHECK ("amountMinor">=0 AND "settledMinor">=0 AND "settledMinor"<="amountMinor" AND "reminderDays">=0 AND "reminderDays"<=365);
ALTER TABLE "MoneyControlRecord" ADD CONSTRAINT "MoneyControlRecord_period_check" CHECK ("endsOn" IS NULL OR "endsOn">="occurredOn");
ALTER TABLE "MoneyControlMovement" ADD CONSTRAINT "MoneyControlMovement_nonzero_check" CHECK ("amountMinor"<>0);
ALTER TABLE "MoneyControlMovement" ADD CONSTRAINT "MoneyControlMovement_account_tenant_fkey" FOREIGN KEY ("workspaceId","accountId") REFERENCES "FinanceAccount"("workspaceId","id") ON DELETE NO ACTION ON UPDATE CASCADE;
