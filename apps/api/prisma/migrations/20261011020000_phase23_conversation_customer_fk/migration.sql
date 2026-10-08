-- AI conversations are linked to their customer (set null if the customer record is ever removed).
CREATE INDEX IF NOT EXISTS "ai_conversations_customerId_idx" ON "ai_conversations"("customerId");
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
