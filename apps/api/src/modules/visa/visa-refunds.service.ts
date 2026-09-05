import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InvoiceStatus,
  VisaApplicationStatus,
  VisaRefundStatus,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinancePostingService } from '../finance/finance-posting.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { InvoicesService } from '../payments/invoices.service';
import { NotificationsService } from '../notifications/notifications.service';
import { VisaProviderRouter } from './providers/visa-provider.router';

export interface VisaRefundPreview {
  amountPaid: number;
  supplierPenalty: number;
  agencyFee: number;
  refundAmount: number;
  currency: string;
  alreadySubmittedToProvider: boolean;
}

/**
 * Spec #21 — visa cancellation/refund, reusing the exact same finance/refund
 * primitives HotelRefundsService uses (FinancePostingService.postRefund +
 * cancelIncentivesForSource), never a second refund-ledger path:
 *
 *   refundAmount = amountPaid − supplierPenalty − agencyFee
 *
 * Unlike a hotel stay (refundable-until-check-in), a visa fee's
 * refundability hinges on whether it has already been filed with the
 * embassy/agent — once VisaSubmissionsService has submitted the
 * application, the embassy/agent's own cost (companyCostSnapshot, captured
 * at submission time so a later catalog price change can never alter it) is
 * treated as forfeited, matching how real visa agencies operate. The
 * agency's own cancellation fee is a configurable percentage, same pattern
 * as hotels' agencyFeePercent, read from whichever visa provider is active.
 */
@Injectable()
export class VisaRefundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrationsService: IntegrationsService,
    private readonly visaProviderRouter: VisaProviderRouter,
    private readonly invoicesService: InvoicesService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
    private readonly financePostingService: FinancePostingService,
  ) {}

  private async policyConfig(): Promise<{ agencyFeePercent: number }> {
    const providerName = await this.visaProviderRouter.getActiveProviderName();
    const config = await this.integrationsService.getCredentialConfig(
      'VISA',
      providerName,
    );
    return { agencyFeePercent: Number(config?.refundAgencyFeePercent) || 0 };
  }

  private async getApplication(
    applicationId: string,
    ownerCustomerId?: string,
  ) {
    const application = await this.prisma.visaApplication.findUnique({
      where: { id: applicationId },
      include: { invoice: true, refund: true },
    });
    if (!application) {
      throw new NotFoundException('Visa application not found');
    }
    if (ownerCustomerId && application.customerId !== ownerCustomerId) {
      throw new ForbiddenException(
        'This application does not belong to this customer',
      );
    }
    return application;
  }

  async previewRefund(
    applicationId: string,
    ownerCustomerId?: string,
  ): Promise<VisaRefundPreview> {
    const application = await this.getApplication(
      applicationId,
      ownerCustomerId,
    );
    const policy = await this.policyConfig();
    const submission = await this.prisma.visaSubmission.findFirst({
      where: { applicationId },
    });

    const agencyFee = Math.round(
      application.totalAmount * (policy.agencyFeePercent / 100),
    );
    const supplierPenalty = submission
      ? (application.companyCostSnapshot ?? 0)
      : 0;
    const refundAmount = Math.max(
      0,
      application.totalAmount - supplierPenalty - agencyFee,
    );

    return {
      amountPaid: application.totalAmount,
      supplierPenalty,
      agencyFee,
      refundAmount,
      currency: application.currency,
      alreadySubmittedToProvider: !!submission,
    };
  }

  async requestRefund(
    applicationId: string,
    opts: {
      requestedByStaffId?: string;
      requestedByCustomer?: boolean;
      reason?: string;
    },
  ) {
    const application = await this.getApplication(applicationId);
    if (application.refund) {
      throw new ConflictException('This application has already been refunded');
    }
    if (
      !application.invoice ||
      application.invoice.status !== InvoiceStatus.PAID
    ) {
      throw new ConflictException(
        'No verified payment exists on this application to refund',
      );
    }

    const preview = await this.previewRefund(applicationId);

    const [refund] = await this.prisma.$transaction([
      this.prisma.visaRefund.create({
        data: {
          applicationId,
          requestedByStaffId: opts.requestedByStaffId,
          requestedByCustomer: opts.requestedByCustomer ?? false,
          amountPaid: preview.amountPaid,
          supplierPenalty: preview.supplierPenalty,
          agencyFee: preview.agencyFee,
          refundAmount: preview.refundAmount,
          currency: preview.currency,
          status: VisaRefundStatus.COMPLETED,
          reason: opts.reason,
          completedAt: new Date(),
        },
      }),
      this.prisma.visaApplication.update({
        where: { id: applicationId },
        data: { status: VisaApplicationStatus.CANCELLED },
      }),
    ]);

    await this.invoicesService.voidVisaApplicationIfUnpaid(applicationId);

    if (preview.refundAmount > 0) {
      await this.financePostingService.postRefund({
        amount: preview.refundAmount,
        currency: preview.currency,
        reference: `VREFUND-${refund.id}`,
        description: `Visa refund for application ${application.applicationReference}`,
        sourceModule: 'VISA_REFUND',
        sourceId: refund.id,
      });
    }
    await this.financePostingService.cancelIncentivesForSource(
      'VISA_APPLICATION',
      applicationId,
      `Application ${application.applicationReference} was refunded`,
    );

    await this.auditService.record({
      action: 'visa_refund.completed',
      entityType: 'VisaRefund',
      entityId: refund.id,
      metadata: { applicationId, refundAmount: preview.refundAmount },
    });

    const customer = await this.prisma.customer.findUnique({
      where: { id: application.customerId },
      include: { identity: { select: { email: true, id: true } } },
    });
    if (customer) {
      await this.notificationsService.sendGeneric(
        customer.identity.email,
        customer.identity.id,
        `Refund completed — ${application.applicationReference}`,
        `Your refund of ${preview.currency} ${preview.refundAmount} for application ${application.applicationReference} has been completed.`,
      );
    }

    return refund;
  }

  listAll(filters: { applicationId?: string; status?: VisaRefundStatus }) {
    return this.prisma.visaRefund.findMany({
      where: filters,
      include: {
        application: { select: { applicationReference: true, currency: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
