import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus, Prisma } from '@prisma/client';

/**
 * Concurrency guards for money (Phase 22 S-13/S-15).
 *
 * "Read the balance, check it, then write" is a race: two requests both read 100, both decide 80 is
 * fine, both write 80. The fix is to serialise on the thing being spent. Postgres advisory
 * transaction locks (`pg_advisory_xact_lock`) do that without needing a table row to lock, and are
 * released automatically when the surrounding transaction ends. Every code path that spends a
 * wallet or pays an invoice takes the same lock key, so they exclude each other too.
 *
 * These helpers must be called with the `tx` of an interactive `$transaction`.
 */

export type Tx = Prisma.TransactionClient;

const key = (kind: 'invoice' | 'wallet', id: string) => `${kind}:${id}`;

export async function lockInvoice(tx: Tx, invoiceId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key('invoice', invoiceId)}))`;
}

/** Locks several wallets in a stable order, so two opposite transfers cannot deadlock each other. */
export async function lockWallets(tx: Tx, walletIds: string[]): Promise<void> {
  for (const id of [...new Set(walletIds)].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key('wallet', id)}))`;
  }
}

export async function walletBalance(tx: Tx, walletId: string): Promise<number> {
  const result = await tx.walletTransaction.aggregate({
    where: { walletId, status: 'COMPLETED' },
    _sum: { amount: true },
  });
  return result._sum.amount ?? 0;
}

export interface InvoiceStanding {
  status: InvoiceStatus;
  totalAmount: number;
  paid: number;
  outstanding: number;
}

/** The invoice's standing, computed inside the transaction (after its lock). */
export async function invoiceStanding(
  tx: Tx,
  invoiceId: string,
): Promise<InvoiceStanding> {
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      status: true,
      totalAmount: true,
      payments: { select: { amount: true } },
    },
  });
  if (!invoice) throw new NotFoundException('Invoice not found');
  const paid = invoice.payments.reduce((sum, p) => sum + p.amount, 0);
  return {
    status: invoice.status,
    totalAmount: invoice.totalAmount,
    paid,
    outstanding: invoice.totalAmount - paid,
  };
}

/**
 * Locks the invoice and confirms `amount` can be applied to it right now. Used by every path that
 * records a payment we *choose* to accept (staff-recorded, wallet, approved manual submissions); an
 * online payment that already happened at the gateway is recorded regardless (see PaymentsService).
 */
export async function lockAndAssertPayable(
  tx: Tx,
  invoiceId: string,
  amount: number,
): Promise<InvoiceStanding> {
  await lockInvoice(tx, invoiceId);
  const standing = await invoiceStanding(tx, invoiceId);
  if (standing.status === InvoiceStatus.VOID) {
    throw new ConflictException(
      'Cannot record a payment against a voided invoice',
    );
  }
  if (standing.status === InvoiceStatus.PAID || standing.outstanding <= 0) {
    throw new ConflictException('This invoice is already fully paid');
  }
  if (amount > standing.outstanding) {
    throw new BadRequestException(
      `Payment amount (${amount}) exceeds the outstanding balance (${standing.outstanding})`,
    );
  }
  return standing;
}
