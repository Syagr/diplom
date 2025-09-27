-- Role enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Role') THEN
    CREATE TYPE "Role" AS ENUM ('admin','service_manager','dispatcher','mechanic','customer');
  END IF;
END $$;

-- User table
CREATE TABLE IF NOT EXISTS "User" (
  "id"            SERIAL PRIMARY KEY,
  "email"         TEXT UNIQUE,
  "phone"         TEXT UNIQUE,
  "passwordHash"  TEXT NOT NULL,
  "role"          "Role" NOT NULL DEFAULT 'customer',
  "clientId"      INTEGER,
  "tokenVersion"  INTEGER NOT NULL DEFAULT 0,
  "createdAt"     TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt"     TIMESTAMP NOT NULL DEFAULT NOW()
);

-- FK to Client (если таблица Client есть)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Client') THEN
    ALTER TABLE "User"
      ADD CONSTRAINT IF NOT EXISTS "User_clientId_fkey"
      FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- UpdatedAt trigger
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_user_updated_at'
  ) THEN
    CREATE TRIGGER trg_user_updated_at
    BEFORE UPDATE ON "User"
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
  END IF;
END $$;
