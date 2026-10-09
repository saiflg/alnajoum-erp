-- Financial reconciliation (Phase 24). READ-ONLY: every statement is a SELECT.
--
-- Each row is one invariant of the books. `violations` must be 0 for the invariant to hold; the sample column
-- shows up to three offending ids so a failure can be investigated. Run against any database with:
--
--   docker exec -i alnajoum-postgres psql -U <user> -d <db> -At -F '|' -f - < financial-reconciliation.sql
--
-- What this proves: the money tables agree with each other (invoices vs payments, wallet vs its transactions,
-- reversals vs originals, intents vs payments). What it does NOT prove: that the amounts are right against an
-- external statement (bank, provider settlement) - that needs the bank-reconciliation module and real data.

WITH checks AS (

  -- ---- Journal ------------------------------------------------------------------------------------------
  SELECT 'journal: amount is positive' AS invariant,
         count(*) AS violations,
         string_agg(id, ',') FILTER (WHERE rn <= 3) AS sample
  FROM (SELECT id, row_number() OVER () rn FROM journal_entries WHERE amount <= 0) x

  UNION ALL
  SELECT 'journal: debit and credit accounts differ', count(*), string_agg(id, ',') FILTER (WHERE rn <= 3)
  FROM (SELECT id, row_number() OVER () rn FROM journal_entries WHERE "debitAccountId" = "creditAccountId") x

  UNION ALL
  SELECT 'journal: an entry marked REVERSED has exactly one reversing entry', count(*), string_agg(id, ',') FILTER (WHERE rn <= 3)
  FROM (
    SELECT e.id, row_number() OVER () rn
    FROM journal_entries e
    WHERE e.status = 'REVERSED'
      AND (SELECT count(*) FROM journal_entries r WHERE r."reversalOfId" = e.id) <> 1
  ) x

  UNION ALL
  SELECT 'journal: a reversing entry mirrors its original (same amount and currency, accounts swapped)', count(*), string_agg(id, ',') FILTER (WHERE rn <= 3)
  FROM (
    SELECT r.id, row_number() OVER () rn
    FROM journal_entries r
    JOIN journal_entries o ON o.id = r."reversalOfId"
    WHERE r.amount <> o.amount OR r.currency <> o.currency
       OR r."debitAccountId" <> o."creditAccountId" OR r."creditAccountId" <> o."debitAccountId"
  ) x

  UNION ALL
  SELECT 'journal: a reversing entry points at an entry that is marked REVERSED', count(*), string_agg(id, ',') FILTER (WHERE rn <= 3)
  FROM (
    SELECT r.id, row_number() OVER () rn
    FROM journal_entries r
    JOIN journal_entries o ON o.id = r."reversalOfId"
    WHERE o.status <> 'REVERSED'
  ) x

  UNION ALL
  -- A reversal deliberately reuses its original's reference, so uniqueness is required of original postings only.
  SELECT 'journal: an original posting is never made twice (unique reference among non-reversal entries)', count(*), string_agg(reference, ',') FILTER (WHERE rn <= 3)
  FROM (
    SELECT reference, row_number() OVER () rn FROM journal_entries WHERE "reversalOfId" IS NULL GROUP BY reference HAVING count(*) > 1
  ) x

  UNION ALL
  SELECT 'journal: debits equal credits per currency (the ledger balances)', count(*), string_agg(currency, ',')
  FROM (
    SELECT currency
    FROM (
      SELECT currency, amount AS signed FROM journal_entries           -- every entry debits one account ...
      UNION ALL
      SELECT currency, -amount FROM journal_entries                    -- ... and credits another by the same amount
    ) s
    GROUP BY currency HAVING sum(signed) <> 0
  ) x

  -- ---- Invoices vs payments ---------------------------------------------------------------------------------
  UNION ALL
  SELECT 'invoice: PAID means payments total exactly the invoice total', count(*), string_agg(id, ',') FILTER (WHERE rn <= 3)
  FROM (
    SELECT i.id, row_number() OVER () rn
    FROM invoices i
    WHERE i.status = 'PAID'
      AND coalesce((SELECT sum(p.amount) FROM payments p WHERE p."invoiceId" = i.id), 0) <> i."totalAmount"
  ) x

  UNION ALL
  SELECT 'invoice: PARTIALLY_PAID means 0 < payments < total', count(*), string_agg(id, ',') FILTER (WHERE rn <= 3)
  FROM (
    SELECT i.id, row_number() OVER () rn
    FROM invoices i
    WHERE i.status = 'PARTIALLY_PAID'
      AND NOT (coalesce((SELECT sum(p.amount) FROM payments p WHERE p."invoiceId" = i.id), 0) > 0
               AND coalesce((SELECT sum(p.amount) FROM payments p WHERE p."invoiceId" = i.id), 0) < i."totalAmount")
  ) x

  UNION ALL
  SELECT 'invoice: ISSUED means nothing has been paid', count(*), string_agg(id, ',') FILTER (WHERE rn <= 3)
  FROM (
    SELECT i.id, row_number() OVER () rn
    FROM invoices i
    WHERE i.status = 'ISSUED'
      AND coalesce((SELECT sum(p.amount) FROM payments p WHERE p."invoiceId" = i.id), 0) <> 0
  ) x

  UNION ALL
  SELECT 'invoice: no invoice is over-paid', count(*), string_agg(id, ',') FILTER (WHERE rn <= 3)
  FROM (
    SELECT i.id, row_number() OVER () rn
    FROM invoices i
    WHERE i.status <> 'VOID'
      AND coalesce((SELECT sum(p.amount) FROM payments p WHERE p."invoiceId" = i.id), 0) > i."totalAmount"
  ) x

  UNION ALL
  SELECT 'invoice: total equals the sum of its line items', count(*), string_agg(id, ',') FILTER (WHERE rn <= 3)
  FROM (
    SELECT i.id, row_number() OVER () rn
    FROM invoices i
    WHERE EXISTS (SELECT 1 FROM invoice_line_items l WHERE l."invoiceId" = i.id)
      AND (SELECT sum(l.amount) FROM invoice_line_items l WHERE l."invoiceId" = i.id) <> i."totalAmount"
  ) x

  UNION ALL
  SELECT 'payment: references are unique', count(*), string_agg("paymentReference", ',') FILTER (WHERE rn <= 3)
  FROM (SELECT "paymentReference", row_number() OVER () rn FROM payments GROUP BY "paymentReference" HAVING count(*) > 1) x

  UNION ALL
  SELECT 'payment: amount is positive', count(*), string_agg(id, ',') FILTER (WHERE rn <= 3)
  FROM (SELECT id, row_number() OVER () rn FROM payments WHERE amount <= 0) x

  -- ---- Online payment intents ------------------------------------------------------------------------------
  UNION ALL
  SELECT 'intent: every SUCCEEDED intent produced exactly one payment with the intent reference', count(*), string_agg(id, ',') FILTER (WHERE rn <= 3)
  FROM (
    SELECT pi.id, row_number() OVER () rn
    FROM payment_intents pi
    WHERE pi.status = 'SUCCEEDED'
      AND (SELECT count(*) FROM payments p WHERE p."paymentReference" = pi.reference) <> 1
  ) x

  UNION ALL
  SELECT 'intent: a payment taken through an intent has the intent amount', count(*), string_agg(pi.id, ',') FILTER (WHERE rn <= 3)
  FROM (
    SELECT pi.id, row_number() OVER () rn
    FROM payment_intents pi
    JOIN payments p ON p."paymentReference" = pi.reference
    WHERE p.amount <> pi.amount
  ) pi

  UNION ALL
  SELECT 'intent: no PENDING or FAILED intent has a payment', count(*), string_agg(id, ',') FILTER (WHERE rn <= 3)
  FROM (
    SELECT pi.id, row_number() OVER () rn
    FROM payment_intents pi
    WHERE pi.status <> 'SUCCEEDED'
      AND EXISTS (SELECT 1 FROM payments p WHERE p."paymentReference" = pi.reference)
  ) x

  -- ---- Wallet ---------------------------------------------------------------------------------------------
  UNION ALL
  SELECT 'wallet: no wallet has a negative balance (sum of COMPLETED transactions)', count(*), string_agg(id, ',') FILTER (WHERE rn <= 3)
  FROM (
    SELECT w.id, row_number() OVER () rn
    FROM wallets w
    WHERE coalesce((SELECT sum(t.amount) FROM wallet_transactions t WHERE t."walletId" = w.id AND t.status = 'COMPLETED'), 0) < 0
  ) x

  UNION ALL
  SELECT 'wallet: transaction references are unique', count(*), string_agg(reference, ',') FILTER (WHERE rn <= 3)
  FROM (SELECT reference, row_number() OVER () rn FROM wallet_transactions GROUP BY reference HAVING count(*) > 1) x

  UNION ALL
  SELECT 'wallet: a transfer-out has a matching transfer-in of the same size', count(*), string_agg(reference, ',') FILTER (WHERE rn <= 3)
  FROM (
    SELECT o.reference, row_number() OVER () rn
    FROM wallet_transactions o
    WHERE o.type = 'TRANSFER_OUT' AND o.status = 'COMPLETED'
      AND NOT EXISTS (
        SELECT 1 FROM wallet_transactions i
        WHERE i.type = 'TRANSFER_IN' AND i.status = 'COMPLETED' AND i.amount = -o.amount AND i.currency = o.currency
          AND i."createdAt" BETWEEN o."createdAt" - interval '5 seconds' AND o."createdAt" + interval '5 seconds'
      )
  ) x

  UNION ALL
  SELECT 'wallet: a wallet payment against an invoice is matched by a payment row', count(*), string_agg(id, ',') FILTER (WHERE rn <= 3)
  FROM (
    SELECT t.id, row_number() OVER () rn
    FROM wallet_transactions t
    WHERE t.type = 'PAYMENT' AND t.status = 'COMPLETED' AND t."invoiceId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM payments p WHERE p."invoiceId" = t."invoiceId" AND p.amount = -t.amount)
  ) x
)
SELECT invariant || '|' || violations || '|' || coalesce(sample, '') || '|' || CASE WHEN violations = 0 THEN 'PASS' ELSE 'FAIL' END
FROM checks;
