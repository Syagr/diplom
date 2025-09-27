-- Migration: extend Attachment with objectKey, contentType, status, removedAt, createdBy

ALTER TABLE "attachments" 
  ADD COLUMN IF NOT EXISTS "objectKey"   TEXT,
  ADD COLUMN IF NOT EXISTS "contentType" TEXT,
  ADD COLUMN IF NOT EXISTS "status"      TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "removedAt"   TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS "createdBy"   INTEGER NULL;

-- mark existing rows as ready if url present
UPDATE "attachments" SET "status" = 'ready' WHERE ("url" IS NOT NULL AND "url" <> '');

-- optional: copy url into objectKey for backup
-- UPDATE "attachments" SET "objectKey" = "url" WHERE "objectKey" IS NULL AND "url" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "attachments_status_idx" ON "attachments" ("status");
CREATE INDEX IF NOT EXISTS "attachments_orderId_idx" ON "attachments" ("orderId");
