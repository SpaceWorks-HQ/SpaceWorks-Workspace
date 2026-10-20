-- AlterTable
ALTER TABLE "Budget" ADD COLUMN     "costCentreId" TEXT,
ADD COLUMN     "varianceNote" TEXT;

-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN     "accountId" TEXT,
ADD COLUMN     "cgstMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "costCentreId" TEXT,
ADD COLUMN     "extractionUsed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fundId" TEXT,
ADD COLUMN     "gstin" TEXT,
ADD COLUMN     "igstMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "incomeSource" TEXT NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "invoiceNumber" TEXT,
ADD COLUMN     "privatePayroll" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "purpose" TEXT,
ADD COLUMN     "reconciledAt" TIMESTAMP(3),
ADD COLUMN     "sgstMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "taxableMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tdsMinor" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "FinanceFund" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "funder" TEXT,
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceFund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceCostCentre" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PROGRAMME',
    "projectId" TEXT,
    "externalReference" TEXT,
    "externalUrl" TEXT,
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceCostCentre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceAccount" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "openingMinor" INTEGER NOT NULL DEFAULT 0,
    "openingOn" DATE NOT NULL,
    "reconciledUpTo" DATE,

    CONSTRAINT "FinanceAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceBill" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "issuedOn" DATE NOT NULL,
    "dueOn" DATE NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "paidMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "gstin" TEXT,
    "taxableMinor" INTEGER NOT NULL DEFAULT 0,
    "cgstMinor" INTEGER NOT NULL DEFAULT 0,
    "sgstMinor" INTEGER NOT NULL DEFAULT 0,
    "igstMinor" INTEGER NOT NULL DEFAULT 0,
    "tdsMinor" INTEGER NOT NULL DEFAULT 0,
    "categoryId" TEXT,
    "fundId" TEXT,
    "costCentreId" TEXT,
    "accountId" TEXT,
    "purpose" TEXT,
    "notes" TEXT,
    "ownerId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceBillPayment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "paymentKey" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "paidOn" DATE NOT NULL,
    "reference" TEXT NOT NULL,
    "posted" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceBillPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceMonth" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "signedOffAt" TIMESTAMP(3),
    "signedOffById" TEXT,
    "reviewSignedAt" TIMESTAMP(3),
    "reviewSignedById" TEXT,
    "reviewNotes" TEXT,

    CONSTRAINT "FinanceMonth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceMonthStep" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "monthId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ownerId" TEXT,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,

    CONSTRAINT "FinanceMonthStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceReconciliation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "upTo" DATE NOT NULL,
    "statementMinor" INTEGER NOT NULL,
    "ledgerMinor" BIGINT NOT NULL,
    "notes" TEXT,
    "signedOffAt" TIMESTAMP(3),
    "signedOffById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceAttachment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "extractionUsed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancePayrollGrant" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "manage" BOOLEAN NOT NULL DEFAULT false,
    "grantedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancePayrollGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancePayProfile" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "rateMinor" INTEGER NOT NULL,
    "rateBasis" TEXT NOT NULL DEFAULT 'MONTH',
    "panEnc" TEXT,
    "bankEnc" TEXT,
    "pfApplicable" BOOLEAN NOT NULL DEFAULT false,
    "esiApplicable" BOOLEAN NOT NULL DEFAULT false,
    "ptApplicable" BOOLEAN NOT NULL DEFAULT false,
    "tdsSection" TEXT,
    "costCentreId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancePayProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancePayRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "grossMinor" INTEGER NOT NULL,
    "allowancesMinor" INTEGER NOT NULL DEFAULT 0,
    "pfMinor" INTEGER NOT NULL DEFAULT 0,
    "esiMinor" INTEGER NOT NULL DEFAULT 0,
    "ptMinor" INTEGER NOT NULL DEFAULT 0,
    "tdsMinor" INTEGER NOT NULL DEFAULT 0,
    "advancesMinor" INTEGER NOT NULL DEFAULT 0,
    "otherMinor" INTEGER NOT NULL DEFAULT 0,
    "netMinor" INTEGER NOT NULL,
    "costCentreId" TEXT,
    "accountId" TEXT,
    "categoryId" TEXT,
    "fundId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidOn" DATE,
    "reference" TEXT,
    "ledgerEntryId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancePayRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceDisbursement" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "payee" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "tdsMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "costCentreId" TEXT,
    "fundId" TEXT,
    "accountId" TEXT,
    "categoryId" TEXT,
    "ownerId" TEXT,
    "dueOn" DATE,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approvalId" TEXT,
    "paidOn" DATE,
    "reference" TEXT,
    "ledgerEntryId" TEXT,
    "settledMinor" INTEGER NOT NULL DEFAULT 0,
    "settledOn" DATE,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceDisbursement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceReviewRule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "thresholdMinor" INTEGER NOT NULL,

    CONSTRAINT "FinanceReviewRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinanceFund_workspaceId_archivedAt_idx" ON "FinanceFund"("workspaceId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceFund_workspaceId_id_key" ON "FinanceFund"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceFund_workspaceId_name_key" ON "FinanceFund"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "FinanceCostCentre_workspaceId_archivedAt_idx" ON "FinanceCostCentre"("workspaceId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceCostCentre_workspaceId_id_key" ON "FinanceCostCentre"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceCostCentre_workspaceId_name_key" ON "FinanceCostCentre"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "FinanceAccount_workspaceId_reconciledUpTo_idx" ON "FinanceAccount"("workspaceId", "reconciledUpTo");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceAccount_workspaceId_id_key" ON "FinanceAccount"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceAccount_workspaceId_name_key" ON "FinanceAccount"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "FinanceBill_workspaceId_dueOn_idx" ON "FinanceBill"("workspaceId", "dueOn");

-- CreateIndex
CREATE INDEX "FinanceBill_workspaceId_vendor_number_idx" ON "FinanceBill"("workspaceId", "vendor", "number");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceBill_workspaceId_id_key" ON "FinanceBill"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "FinanceBillPayment_workspaceId_billId_paidOn_idx" ON "FinanceBillPayment"("workspaceId", "billId", "paidOn");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceBillPayment_workspaceId_paymentKey_key" ON "FinanceBillPayment"("workspaceId", "paymentKey");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceMonth_workspaceId_id_key" ON "FinanceMonth"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceMonth_workspaceId_month_key" ON "FinanceMonth"("workspaceId", "month");

-- CreateIndex
CREATE INDEX "FinanceMonthStep_workspaceId_monthId_idx" ON "FinanceMonthStep"("workspaceId", "monthId");

-- CreateIndex
CREATE INDEX "FinanceReconciliation_workspaceId_accountId_upTo_idx" ON "FinanceReconciliation"("workspaceId", "accountId", "upTo");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceAttachment_fileId_key" ON "FinanceAttachment"("fileId");

-- CreateIndex
CREATE INDEX "FinanceAttachment_workspaceId_recordType_recordId_idx" ON "FinanceAttachment"("workspaceId", "recordType", "recordId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancePayrollGrant_workspaceId_userId_key" ON "FinancePayrollGrant"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "FinancePayProfile_workspaceId_archivedAt_idx" ON "FinancePayProfile"("workspaceId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FinancePayProfile_workspaceId_id_key" ON "FinancePayProfile"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "FinancePayRun_workspaceId_month_status_idx" ON "FinancePayRun"("workspaceId", "month", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FinancePayRun_workspaceId_profileId_month_key" ON "FinancePayRun"("workspaceId", "profileId", "month");

-- CreateIndex
CREATE INDEX "FinanceDisbursement_workspaceId_status_dueOn_idx" ON "FinanceDisbursement"("workspaceId", "status", "dueOn");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceReviewRule_workspaceId_categoryId_currency_key" ON "FinanceReviewRule"("workspaceId", "categoryId", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "FileObject_workspaceId_id_key" ON "FileObject"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "LedgerEntry_workspaceId_fundId_occurredOn_idx" ON "LedgerEntry"("workspaceId", "fundId", "occurredOn");

-- CreateIndex
CREATE INDEX "LedgerEntry_workspaceId_costCentreId_occurredOn_idx" ON "LedgerEntry"("workspaceId", "costCentreId", "occurredOn");

-- CreateIndex
CREATE INDEX "LedgerEntry_workspaceId_accountId_occurredOn_idx" ON "LedgerEntry"("workspaceId", "accountId", "occurredOn");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_workspaceId_id_key" ON "LedgerEntry"("workspaceId", "id");

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_workspaceId_fundId_fkey" FOREIGN KEY ("workspaceId", "fundId") REFERENCES "FinanceFund"("workspaceId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_workspaceId_costCentreId_fkey" FOREIGN KEY ("workspaceId", "costCentreId") REFERENCES "FinanceCostCentre"("workspaceId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_workspaceId_accountId_fkey" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "FinanceAccount"("workspaceId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_workspaceId_costCentreId_fkey" FOREIGN KEY ("workspaceId", "costCentreId") REFERENCES "FinanceCostCentre"("workspaceId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceFund" ADD CONSTRAINT "FinanceFund_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceCostCentre" ADD CONSTRAINT "FinanceCostCentre_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceAccount" ADD CONSTRAINT "FinanceAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceBill" ADD CONSTRAINT "FinanceBill_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceBillPayment" ADD CONSTRAINT "FinanceBillPayment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceBillPayment" ADD CONSTRAINT "FinanceBillPayment_workspaceId_billId_fkey" FOREIGN KEY ("workspaceId", "billId") REFERENCES "FinanceBill"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceMonth" ADD CONSTRAINT "FinanceMonth_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceMonthStep" ADD CONSTRAINT "FinanceMonthStep_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceMonthStep" ADD CONSTRAINT "FinanceMonthStep_workspaceId_monthId_fkey" FOREIGN KEY ("workspaceId", "monthId") REFERENCES "FinanceMonth"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceReconciliation" ADD CONSTRAINT "FinanceReconciliation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceReconciliation" ADD CONSTRAINT "FinanceReconciliation_workspaceId_accountId_fkey" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "FinanceAccount"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceAttachment" ADD CONSTRAINT "FinanceAttachment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceAttachment" ADD CONSTRAINT "FinanceAttachment_workspaceId_fileId_fkey" FOREIGN KEY ("workspaceId", "fileId") REFERENCES "FileObject"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancePayrollGrant" ADD CONSTRAINT "FinancePayrollGrant_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancePayProfile" ADD CONSTRAINT "FinancePayProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancePayRun" ADD CONSTRAINT "FinancePayRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancePayRun" ADD CONSTRAINT "FinancePayRun_workspaceId_profileId_fkey" FOREIGN KEY ("workspaceId", "profileId") REFERENCES "FinancePayProfile"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceDisbursement" ADD CONSTRAINT "FinanceDisbursement_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceReviewRule" ADD CONSTRAINT "FinanceReviewRule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Keep manual money and state records valid even for maintenance scripts.
ALTER TABLE "FinanceBill" ADD CONSTRAINT "FinanceBill_amount_check" CHECK ("amountMinor" > 0 AND "paidMinor" >= 0 AND "paidMinor" <= "amountMinor" AND "tdsMinor" >= 0 AND "tdsMinor" <= "amountMinor");
ALTER TABLE "FinanceBillPayment" ADD CONSTRAINT "FinanceBillPayment_amount_check" CHECK ("amountMinor" > 0);
ALTER TABLE "FinancePayRun" ADD CONSTRAINT "FinancePayRun_amount_check" CHECK ("grossMinor" >= 0 AND "allowancesMinor" >= 0 AND "pfMinor" >= 0 AND "esiMinor" >= 0 AND "ptMinor" >= 0 AND "tdsMinor" >= 0 AND "advancesMinor" >= 0 AND "otherMinor" >= 0 AND "netMinor" >= 0 AND "netMinor"::bigint = "grossMinor"::bigint + "allowancesMinor" - "pfMinor" - "esiMinor" - "ptMinor" - "tdsMinor" - "advancesMinor" - "otherMinor");
ALTER TABLE "FinancePayRun" ADD CONSTRAINT "FinancePayRun_status_check" CHECK ("status" IN ('DRAFT','APPROVED','PAID'));
ALTER TABLE "FinanceDisbursement" ADD CONSTRAINT "FinanceDisbursement_amount_check" CHECK ("amountMinor" > 0 AND "tdsMinor" >= 0 AND "tdsMinor" <= "amountMinor" AND "settledMinor" >= 0 AND "settledMinor" <= "amountMinor");
ALTER TABLE "FinanceAttachment" ADD CONSTRAINT "FinanceAttachment_type_check" CHECK ("recordType" IN ('STAGED','LEDGER','BILL','FUND','PAY_PROFILE','PAY_RUN','DISBURSEMENT','MONTH'));
