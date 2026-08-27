import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

interface IncentiveRule {
  percent?: number;
}

/**
 * Computes and records the staff incentive earned from a payment against an
 * Umrah registration, per that registration's package.incentiveRule (e.g.
 * { percent: 2 }). Deliberately standalone (Prisma only, no dependency on
 * PaymentsModule/WalletModule/UmrahModule) so every payment path — staff
 * recordPayment, online checkout, wallet payment, approved manual payment —
 * can call it without creating a module import cycle.
 *
 * Informational ledger only: crediting an incentive never touches the
 * invoice, the wallet, or any payout — see StaffIncentive's doc comment in
 * schema.prisma.
 */
@Injectable()
export class IncentivesService {
  private readonly logger = new Logger(IncentivesService.name);

  constructor(private readonly prisma: PrismaService) {}

  listForStaff(staffId: string) {
    return this.prisma.staffIncentive.findMany({
      where: { staffId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async applyForInvoicePayment(
    invoiceId: string,
    paymentAmount: number,
  ): Promise<void> {
    try {
      const invoice = await this.prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: { umrahRegistration: { include: { package: true } } },
      });
      const registration = invoice?.umrahRegistration;
      if (!invoice || !registration || !registration.registeredByStaffId) {
        return;
      }

      const rule = registration.package.incentiveRule as IncentiveRule | null;
      const percent = rule?.percent;
      if (!percent || percent <= 0) return;

      const amount = Math.round((paymentAmount * percent) / 100);
      if (amount <= 0) return;

      await this.prisma.staffIncentive.create({
        data: {
          staffId: registration.registeredByStaffId,
          sourceType: 'UMRAH_REGISTRATION',
          sourceId: registration.id,
          amount,
          currency: invoice.currency,
          description: `${percent}% incentive on ${invoice.currency} ${paymentAmount} payment for ${registration.registrationNumber}`,
        },
      });
    } catch (error) {
      // Never let incentive bookkeeping fail the payment it's attached to.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to apply staff incentive: ${message}`);
    }
  }
}
