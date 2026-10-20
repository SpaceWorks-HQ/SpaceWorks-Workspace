-- CreateTable
CREATE TABLE "BusinessDocument" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "issuedOn" DATE NOT NULL,
    "dueOn" DATE,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "financialYear" TEXT,
    "number" TEXT,
    "registrationId" TEXT NOT NULL DEFAULT '',
    "ownerId" TEXT NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "parentId" TEXT,
    "input" JSONB NOT NULL,
    "snapshot" JSONB,
    "totalMinor" INTEGER NOT NULL DEFAULT 0,
    "issuedAt" TIMESTAMP(3),
    "issuedById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentSeries" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL DEFAULT '',
    "financialYear" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "padding" INTEGER NOT NULL DEFAULT 5,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "locked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DocumentSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentReference" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentFile" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "documentId" TEXT,
    "kind" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentAllocation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "cashMinor" INTEGER NOT NULL,
    "tdsMinor" INTEGER NOT NULL DEFAULT 0,
    "key" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentDelivery" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "outboxId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BusinessDocument_workspaceId_status_issuedOn_idx" ON "BusinessDocument"("workspaceId", "status", "issuedOn");

-- CreateIndex
CREATE INDEX "BusinessDocument_workspaceId_ownerId_idx" ON "BusinessDocument"("workspaceId", "ownerId");

-- CreateIndex
CREATE INDEX "BusinessDocument_workspaceId_parentId_idx" ON "BusinessDocument"("workspaceId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessDocument_workspaceId_id_key" ON "BusinessDocument"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessDocument_workspaceId_financialYear_number_key" ON "BusinessDocument"("workspaceId", "financialYear", "number");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessDocument_workspaceId_type_sourceType_sourceId_key" ON "BusinessDocument"("workspaceId", "type", "sourceType", "sourceId") WHERE type NOT IN ('CSR_UC','GOVERNMENT_UC') AND "parentId" IS NULL;
CREATE INDEX "BusinessDocument_workspaceId_sourceType_sourceId_idx" ON "BusinessDocument"("workspaceId","sourceType","sourceId");

-- CreateIndex
CREATE INDEX "DocumentSeries_workspaceId_financialYear_idx" ON "DocumentSeries"("workspaceId", "financialYear");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentSeries_workspaceId_type_registrationId_financialYea_key" ON "DocumentSeries"("workspaceId", "type", "registrationId", "financialYear");

-- CreateIndex
CREATE INDEX "DocumentReference_workspaceId_kind_archivedAt_idx" ON "DocumentReference"("workspaceId", "kind", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentReference_workspaceId_id_key" ON "DocumentReference"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "DocumentFile_workspaceId_documentId_kind_idx" ON "DocumentFile"("workspaceId", "documentId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentFile_workspaceId_fileId_key" ON "DocumentFile"("workspaceId", "fileId");

-- CreateIndex
CREATE INDEX "DocumentAllocation_workspaceId_invoiceId_idx" ON "DocumentAllocation"("workspaceId", "invoiceId");

-- CreateIndex
CREATE INDEX "DocumentAllocation_workspaceId_receiptId_idx" ON "DocumentAllocation"("workspaceId", "receiptId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentAllocation_workspaceId_key_key" ON "DocumentAllocation"("workspaceId", "key");

-- CreateIndex
CREATE INDEX "DocumentDelivery_workspaceId_documentId_createdAt_idx" ON "DocumentDelivery"("workspaceId", "documentId", "createdAt");

-- AddForeignKey
ALTER TABLE "BusinessDocument" ADD CONSTRAINT "BusinessDocument_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessDocument" ADD CONSTRAINT "BusinessDocument_workspaceId_parentId_fkey" FOREIGN KEY ("workspaceId", "parentId") REFERENCES "BusinessDocument"("workspaceId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSeries" ADD CONSTRAINT "DocumentSeries_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentReference" ADD CONSTRAINT "DocumentReference_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentFile" ADD CONSTRAINT "DocumentFile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentFile" ADD CONSTRAINT "DocumentFile_workspaceId_documentId_fkey" FOREIGN KEY ("workspaceId", "documentId") REFERENCES "BusinessDocument"("workspaceId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentFile" ADD CONSTRAINT "DocumentFile_workspaceId_fileId_fkey" FOREIGN KEY ("workspaceId", "fileId") REFERENCES "FileObject"("workspaceId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAllocation" ADD CONSTRAINT "DocumentAllocation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAllocation" ADD CONSTRAINT "DocumentAllocation_workspaceId_receiptId_fkey" FOREIGN KEY ("workspaceId", "receiptId") REFERENCES "BusinessDocument"("workspaceId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAllocation" ADD CONSTRAINT "DocumentAllocation_workspaceId_invoiceId_fkey" FOREIGN KEY ("workspaceId", "invoiceId") REFERENCES "BusinessDocument"("workspaceId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentDelivery" ADD CONSTRAINT "DocumentDelivery_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentDelivery" ADD CONSTRAINT "DocumentDelivery_workspaceId_documentId_fkey" FOREIGN KEY ("workspaceId", "documentId") REFERENCES "BusinessDocument"("workspaceId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- Protect frozen statutory facts independently of application call sites.
CREATE FUNCTION sww_document_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' AND EXISTS (SELECT 1 FROM "Workspace" WHERE id=OLD."workspaceId") THEN
      RAISE EXCEPTION 'Issued and reserved documents must be retained';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('ISSUED','CANCELLED') THEN
    IF (to_jsonb(NEW) - ARRAY['status','cancelledAt','cancelledById','cancelReason','updatedAt']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status','cancelledAt','cancelledById','cancelReason','updatedAt']) OR
       (OLD.status='CANCELLED' AND to_jsonb(NEW) - 'updatedAt' IS DISTINCT FROM to_jsonb(OLD) - 'updatedAt') OR
       NEW.status NOT IN ('ISSUED','CANCELLED') THEN
      RAISE EXCEPTION 'Issued document facts are immutable';
    END IF;
  END IF;
  IF OLD.status='RESERVED' AND (
    NEW.input IS DISTINCT FROM OLD.input OR NEW.number IS DISTINCT FROM OLD.number OR
    NEW."workspaceId" IS DISTINCT FROM OLD."workspaceId" OR
    (NEW.snapshot - 'evidence') IS DISTINCT FROM (OLD.snapshot - 'evidence') OR NEW.status NOT IN ('RESERVED','ISSUED','CANCELLED')) THEN
    RAISE EXCEPTION 'Reserved document facts are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sww_document_immutable BEFORE UPDATE OR DELETE ON "BusinessDocument" FOR EACH ROW EXECUTE FUNCTION sww_document_immutable();
ALTER TABLE "BusinessDocument" ADD CONSTRAINT "BusinessDocument_status_check" CHECK (status IN ('DRAFT','RESERVED','ISSUED','CANCELLED'));
ALTER TABLE "DocumentAllocation" ADD CONSTRAINT "DocumentAllocation_amount_check" CHECK ("cashMinor">=0 AND "tdsMinor">=0 AND ("cashMinor">0 OR "tdsMinor">0));
ALTER TABLE "DocumentSeries" ADD CONSTRAINT "DocumentSeries_counter_check" CHECK ("nextNumber">0 AND padding BETWEEN 1 AND 6);
CREATE FUNCTION sww_document_file_protected() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM "DocumentFile" f WHERE f."workspaceId"=OLD."workspaceId" AND f."fileId"=OLD.id) AND EXISTS(SELECT 1 FROM "Workspace" WHERE id=OLD."workspaceId") THEN
   IF TG_OP='DELETE' OR NEW."deletedAt" IS DISTINCT FROM OLD."deletedAt" OR NEW."storageKey" IS DISTINCT FROM OLD."storageKey" OR NEW.checksum IS DISTINCT FROM OLD.checksum OR NEW.folder IS DISTINCT FROM OLD.folder THEN
     RAISE EXCEPTION 'Document evidence is protected from deletion and replacement';
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sww_document_file_protected BEFORE UPDATE OR DELETE ON "FileObject" FOR EACH ROW EXECUTE FUNCTION sww_document_file_protected();
CREATE FUNCTION sww_document_link_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."documentId" IS NOT NULL AND EXISTS(SELECT 1 FROM "BusinessDocument" WHERE "workspaceId"=OLD."workspaceId" AND id=OLD."documentId" AND status<>'DRAFT') AND EXISTS(SELECT 1 FROM "Workspace" WHERE id=OLD."workspaceId") THEN
 RAISE EXCEPTION 'Issued document evidence links must be retained';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sww_document_link_immutable BEFORE UPDATE OR DELETE ON "DocumentFile" FOR EACH ROW EXECUTE FUNCTION sww_document_link_immutable();
CREATE FUNCTION sww_document_filing_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.kind='FILING_BATCH' AND OLD.data->>'status'='ACCEPTED' AND EXISTS(SELECT 1 FROM "Workspace" WHERE id=OLD."workspaceId") THEN
 RAISE EXCEPTION 'Accepted filing batches must be retained unchanged';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sww_document_filing_immutable BEFORE UPDATE OR DELETE ON "DocumentReference" FOR EACH ROW EXECUTE FUNCTION sww_document_filing_immutable();
-- Retain previously issued fundraising PDFs without renumbering or recreating them.
INSERT INTO "BusinessDocument" (id,"workspaceId",type,status,title,"issuedOn",currency,number,"ownerId","sourceType","sourceId",input,snapshot,"totalMinor","issuedAt","issuedById","cancelReason","createdAt","updatedAt")
SELECT 'legacy-donation-'||md5(g."workspaceId"||':'||g.id),g."workspaceId",'DONATION_RECEIPT',CASE WHEN g.status='VOID' THEN 'CANCELLED' ELSE 'ISSUED' END,
 'Legacy donation receipt '||g."receiptNumber",COALESCE(g."dateOn",g."createdAt"),g.currency,g."receiptNumber",COALESCE(g."ownerId",g."createdById",'legacy-import'),'FUNDING',g.id,
 jsonb_build_object('type','DONATION_RECEIPT','title','Legacy donation receipt '||g."receiptNumber",'issuedOn',to_char(COALESCE(g."dateOn",g."createdAt"),'YYYY-MM-DD'),'currency',g.currency,'partyName',COALESCE(c."displayName",g.title),'partyAddress',COALESCE(g.details->>'donorAddress',''),'cashMinor',g."amountMinor",'sourceType','FUNDING','sourceId',g.id,'contactId',COALESCE(g."contactId",'')),
 jsonb_build_object('version',1,'templateVersion','funding-legacy','number',g."receiptNumber",'input',jsonb_build_object('type','DONATION_RECEIPT','title',g.title,'issuedOn',to_char(COALESCE(g."dateOn",g."createdAt"),'YYYY-MM-DD'),'currency',g.currency,'partyName',COALESCE(c."displayName",g.title),'partyAddress',COALESCE(g.details->>'donorAddress','')),'identity',jsonb_build_object('name','Legacy donation receipt — see original stored PDF'),'profile','{}'::jsonb,'registration','{}'::jsonb,'signatory','{}'::jsonb,'letter','','source',jsonb_build_object('legacyArtifact',true,'fundingId',g.id,'checksum',f.checksum),'calculation',jsonb_build_object('policy','legacy-pdf','mode','NONE','rows','[]'::jsonb,'taxableMinor',0,'cgstMinor',0,'sgstMinor',0,'igstMinor',0,'vatMinor',0,'cessMinor',0,'roundOffMinor',0,'totalMinor',g."amountMinor")),
 g."amountMinor",g."updatedAt",g."createdById",CASE WHEN g.status='VOID' THEN 'Source donation was voided in Funding.' END,g."createdAt",now()
FROM "FundingRecord" g JOIN "FileObject" f ON f.id=g."receiptFileId" AND f."workspaceId"=g."workspaceId" AND f."deletedAt" IS NULL
LEFT JOIN "Contact" c ON c.id=g."contactId" AND c."workspaceId"=g."workspaceId"
WHERE g.kind='DONATION' AND g."receiptNumber" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "BusinessDocument" b WHERE b."workspaceId"=g."workspaceId" AND b."sourceType"='FUNDING' AND b."sourceId"=g.id AND b.type IN ('DONATION_RECEIPT','FCRA_RECEIPT'));
INSERT INTO "DocumentFile"(id,"workspaceId","documentId",kind,"fileId","createdAt")
SELECT 'legacy-receipt-file-'||md5(b.id),b."workspaceId",b.id,'PDF',g."receiptFileId",now()
FROM "BusinessDocument" b JOIN "FundingRecord" g ON g.id=b."sourceId" AND g."workspaceId"=b."workspaceId"
WHERE b.id LIKE 'legacy-donation-%' AND b."sourceType"='FUNDING' AND NOT EXISTS(SELECT 1 FROM "DocumentFile" f WHERE f."workspaceId"=b."workspaceId" AND f."fileId"=g."receiptFileId");
INSERT INTO "AuditEvent"(id,"workspaceId",action,"targetType","targetId",metadata,"createdAt")
SELECT 'legacy-document-audit-'||md5(b.id),b."workspaceId",'documents.legacy_receipt_retained','business_document',b.id,'{"legacy":true}'::jsonb,now() FROM "BusinessDocument" b
WHERE b.id LIKE 'legacy-donation-%' AND NOT EXISTS(SELECT 1 FROM "AuditEvent" a WHERE a."workspaceId"=b."workspaceId" AND a."targetId"=b.id AND a.action='documents.legacy_receipt_retained');
INSERT INTO "DocumentDelivery"(id,"workspaceId","documentId",recipient,"fileId",checksum,"outboxId","createdById","createdAt")
SELECT 'legacy-delivery-'||md5(o.id),b."workspaceId",b.id,o.payload->>'to',f."fileId",COALESCE(file.checksum,''),o.id,'legacy-import',o."createdAt"
FROM "BusinessDocument" b JOIN "DocumentFile" f ON f."documentId"=b.id AND f."workspaceId"=b."workspaceId" AND f.kind='PDF'
JOIN "FileObject" file ON file.id=f."fileId" AND file."workspaceId"=b."workspaceId"
JOIN "OutboxMessage" o ON o.kind='email' AND o.payload->>'workspaceId'=b."workspaceId" AND o.payload->'fundingReceipt'->>'recordId'=b."sourceId" AND o.payload->'fundingReceipt'->>'fileId'=f."fileId"
WHERE b."sourceType"='FUNDING' AND o.payload->>'to' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "DocumentDelivery" d WHERE d."workspaceId"=b."workspaceId" AND d."outboxId"=o.id);
