-- AlterTable
ALTER TABLE "FinanceBill" ADD COLUMN     "needsActual" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "privatePayroll" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "RecurringCostSchedule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payee" TEXT NOT NULL,
    "contactId" TEXT,
    "organisationId" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "estimated" BOOLEAN NOT NULL DEFAULT false,
    "frequency" TEXT NOT NULL DEFAULT 'MONTHLY',
    "dueDay" INTEGER NOT NULL DEFAULT 1,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE,
    "nextDueOn" DATE NOT NULL,
    "leadDays" INTEGER NOT NULL DEFAULT 14,
    "reminderDays" INTEGER NOT NULL DEFAULT 7,
    "categoryId" TEXT,
    "fundId" TEXT,
    "costCentreId" TEXT,
    "accountId" TEXT,
    "ownerId" TEXT,
    "gstPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tdsSection" TEXT NOT NULL DEFAULT '',
    "tdsPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "leaseId" TEXT,
    "subscriptionId" TEXT,
    "insuranceId" TEXT,
    "depositId" TEXT,
    "escalationPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "renewalOn" DATE,
    "renewalReminderDays" INTEGER NOT NULL DEFAULT 30,
    "principalMinor" INTEGER NOT NULL DEFAULT 0,
    "annualRatePercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tenure" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringCostSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringCostDue" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "scheduleId" TEXT,
    "sourceKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dueOn" DATE NOT NULL,
    "billId" TEXT NOT NULL,
    "payRunId" TEXT,
    "principalMinor" INTEGER NOT NULL DEFAULT 0,
    "interestMinor" INTEGER NOT NULL DEFAULT 0,
    "splitConfirmed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "RecurringCostDue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffAdvance" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "instalments" INTEGER NOT NULL,
    "startsOn" DATE NOT NULL,
    "accountId" TEXT NOT NULL,
    "costCentreId" TEXT,
    "fundId" TEXT,
    "approvalId" TEXT,
    "depositId" TEXT,
    "paidOn" DATE,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffAdvance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffAdvanceRecovery" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "advanceId" TEXT NOT NULL,
    "instalment" INTEGER NOT NULL,
    "dueOn" DATE NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "recoveredMinor" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StaffAdvanceRecovery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecurringCostSchedule_workspaceId_status_nextDueOn_idx" ON "RecurringCostSchedule"("workspaceId", "status", "nextDueOn");

-- CreateIndex
CREATE INDEX "RecurringCostSchedule_workspaceId_fundId_costCentreId_idx" ON "RecurringCostSchedule"("workspaceId", "fundId", "costCentreId");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringCostSchedule_workspaceId_id_key" ON "RecurringCostSchedule"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringCostSchedule_workspaceId_requestKey_key" ON "RecurringCostSchedule"("workspaceId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringCostSchedule_workspaceId_leaseId_key" ON "RecurringCostSchedule"("workspaceId", "leaseId");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringCostSchedule_workspaceId_insuranceId_key" ON "RecurringCostSchedule"("workspaceId", "insuranceId");

-- CreateIndex
CREATE INDEX "RecurringCostDue_workspaceId_dueOn_kind_idx" ON "RecurringCostDue"("workspaceId", "dueOn", "kind");

-- CreateIndex
CREATE INDEX "RecurringCostDue_workspaceId_scheduleId_idx" ON "RecurringCostDue"("workspaceId", "scheduleId");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringCostDue_workspaceId_sourceKey_key" ON "RecurringCostDue"("workspaceId", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringCostDue_workspaceId_billId_key" ON "RecurringCostDue"("workspaceId", "billId");

-- CreateIndex
CREATE INDEX "StaffAdvance_workspaceId_userId_status_idx" ON "StaffAdvance"("workspaceId", "userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StaffAdvance_workspaceId_id_key" ON "StaffAdvance"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StaffAdvance_workspaceId_requestKey_key" ON "StaffAdvance"("workspaceId", "requestKey");

-- CreateIndex
CREATE INDEX "StaffAdvanceRecovery_workspaceId_dueOn_idx" ON "StaffAdvanceRecovery"("workspaceId", "dueOn");

-- CreateIndex
CREATE UNIQUE INDEX "StaffAdvanceRecovery_workspaceId_advanceId_instalment_key" ON "StaffAdvanceRecovery"("workspaceId", "advanceId", "instalment");

-- AddForeignKey
ALTER TABLE "RecurringCostSchedule" ADD CONSTRAINT "RecurringCostSchedule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringCostDue" ADD CONSTRAINT "RecurringCostDue_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringCostDue" ADD CONSTRAINT "RecurringCostDue_workspaceId_scheduleId_fkey" FOREIGN KEY ("workspaceId", "scheduleId") REFERENCES "RecurringCostSchedule"("workspaceId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringCostDue" ADD CONSTRAINT "RecurringCostDue_workspaceId_billId_fkey" FOREIGN KEY ("workspaceId", "billId") REFERENCES "FinanceBill"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAdvance" ADD CONSTRAINT "StaffAdvance_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAdvanceRecovery" ADD CONSTRAINT "StaffAdvanceRecovery_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAdvanceRecovery" ADD CONSTRAINT "StaffAdvanceRecovery_workspaceId_advanceId_fkey" FOREIGN KEY ("workspaceId", "advanceId") REFERENCES "StaffAdvance"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "RecurringCostSchedule" ADD CONSTRAINT "RecurringCostSchedule_values_check" CHECK (
 "amountMinor">0 AND "dueDay" BETWEEN 1 AND 31 AND "leadDays" BETWEEN 0 AND 90 AND "reminderDays" BETWEEN 0 AND 90
 AND "frequency" IN ('MONTHLY','QUARTERLY','YEARLY') AND "status" IN ('ACTIVE','PAUSED','ENDED')
 AND "gstPercent" BETWEEN 0 AND 100 AND "tdsPercent" BETWEEN 0 AND 100
 AND ("endsOn" IS NULL OR "endsOn">="startsOn"));
ALTER TABLE "RecurringCostDue" ADD CONSTRAINT "RecurringCostDue_split_check" CHECK ("principalMinor">=0 AND "interestMinor">=0);
ALTER TABLE "StaffAdvance" ADD CONSTRAINT "StaffAdvance_values_check" CHECK ("amountMinor">0 AND "instalments" BETWEEN 1 AND 120);
ALTER TABLE "StaffAdvanceRecovery" ADD CONSTRAINT "StaffAdvanceRecovery_values_check" CHECK ("amountMinor">0 AND "recoveredMinor" BETWEEN 0 AND "amountMinor");

-- Keep private schedule and staff-advance evidence in the shared attachment service.
ALTER TABLE "FinanceAttachment" DROP CONSTRAINT "FinanceAttachment_type_check";
ALTER TABLE "FinanceAttachment" ADD CONSTRAINT "FinanceAttachment_type_check"
  CHECK ("recordType" IN ('STAGED','LEDGER','BILL','FUND','PAY_PROFILE','PAY_RUN','DISBURSEMENT','MONTH','RECURRING','ADVANCE'));
