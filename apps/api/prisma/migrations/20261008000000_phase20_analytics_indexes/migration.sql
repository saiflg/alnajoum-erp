-- Phase 20 — indexes for analytics date-range queries. Additive only: no table,
-- column or constraint is changed, so this is safe to apply and to roll back
-- (DROP INDEX). Built without CONCURRENTLY because migrations run in a transaction;
-- on a very large production table, create them CONCURRENTLY by hand first.

CREATE INDEX "flight_bookings_status_createdAt_idx" ON "flight_bookings"("status", "createdAt");
CREATE INDEX "hotel_bookings_status_createdAt_idx" ON "hotel_bookings"("status", "createdAt");
CREATE INDEX "hotel_bookings_branchId_idx" ON "hotel_bookings"("branchId");
CREATE INDEX "payments_paidAt_idx" ON "payments"("paidAt");
CREATE INDEX "support_tickets_createdAt_idx" ON "support_tickets"("createdAt");
