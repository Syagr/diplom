-- WebhookEvent: фиксируем idempotency для провайдерских вебхуков (Stripe и пр.)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'WebhookEvent') THEN
    CREATE TABLE "WebhookEvent" (
      "id"         TEXT PRIMARY KEY,
      "type"       TEXT NOT NULL,
      "receivedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "handled"    BOOLEAN NOT NULL DEFAULT FALSE,
      "payload"    JSONB
    );
  END IF;
END $$;

-- Индексы на Order (ускоряют выборки по клиенту и статусам)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'Order_clientId_idx'
  ) THEN
    CREATE INDEX "Order_clientId_idx" ON "Order" ("clientId");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'Order_status_idx'
  ) THEN
    CREATE INDEX "Order_status_idx" ON "Order" ("status");
  END IF;
END $$;

-- Индексы на Payment (по заказу и статусам)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'Payment_orderId_idx'
  ) THEN
    CREATE INDEX "Payment_orderId_idx" ON "Payment" ("orderId");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'Payment_status_idx'
  ) THEN
    CREATE INDEX "Payment_status_idx" ON "Payment" ("status");
  END IF;
END $$;

-- (опционально) Индексы на Attachment (если ещё нет)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'Attachment_orderId_idx'
  ) THEN
    CREATE INDEX "Attachment_orderId_idx" ON "Attachment" ("orderId");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'Attachment_status_idx'
  ) THEN
    CREATE INDEX "Attachment_status_idx" ON "Attachment" ("status");
  END IF;
END $$;