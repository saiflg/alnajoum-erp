import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { InvoiceStatus, VisaApplicationStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinancePostingService } from '../finance/finance-posting.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { InvoicesService } from '../payments/invoices.service';
import { NotificationsService } from '../notifications/notifications.service';
import { VisaProviderRouter } from './providers/visa-provider.router';
import { VisaRefundsService } from './visa-refunds.service';

describe('VisaRefundsService', () => {
  let service: VisaRefundsService;
  let prisma: {
    visaApplication: { findUnique: jest.Mock; update: jest.Mock };
    visaSubmission: { findFirst: jest.Mock };
    visaRefund: { create: jest.Mock; findMany: jest.Mock };
    customer: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let integrationsService: { getCredentialConfig: jest.Mock };
  let visaProviderRouter: { getActiveProviderName: jest.Mock };
  let invoicesService: { voidVisaApplicationIfUnpaid: jest.Mock };
  let notificationsService: { sendGeneric: jest.Mock };
  let auditService: { record: jest.Mock };
  let financePostingService: {
    postRefund: jest.Mock;
    cancelIncentivesForSource: jest.Mock;
  };

  const paidApplication = {
    id: 'app-1',
    applicationReference: 'VISA-2026-000001',
    customerId: 'cust-1',
    totalAmount: 50000,
    currency: 'NGN',
    companyCostSnapshot: 30000,
    invoice: { status: InvoiceStatus.PAID },
    refund: null,
  };

  beforeEach(async () => {
    prisma = {
      visaApplication: { findUnique: jest.fn(), update: jest.fn() },
      visaSubmission: { findFirst: jest.fn() },
      visaRefund: { create: jest.fn(), findMany: jest.fn() },
      customer: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    };
    integrationsService = {
      getCredentialConfig: jest.fn().mockResolvedValue({}),
    };
    visaProviderRouter = {
      getActiveProviderName: jest.fn().mockResolvedValue('manual'),
    };
    invoicesService = { voidVisaApplicationIfUnpaid: jest.fn() };
    notificationsService = { sendGeneric: jest.fn() };
    auditService = { record: jest.fn() };
    financePostingService = {
      postRefund: jest.fn(),
      cancelIncentivesForSource: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VisaRefundsService,
        { provide: PrismaService, useValue: prisma },
        { provide: IntegrationsService, useValue: integrationsService },
        { provide: VisaProviderRouter, useValue: visaProviderRouter },
        { provide: InvoicesService, useValue: invoicesService },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: AuditService, useValue: auditService },
        { provide: FinancePostingService, useValue: financePostingService },
      ],
    }).compile();

    service = module.get(VisaRefundsService);
  });

  describe('previewRefund', () => {
    it('refunds the full amount minus the agency fee when nothing has been submitted to the provider yet', async () => {
      prisma.visaApplication.findUnique.mockResolvedValue({
        ...paidApplication,
      });
      prisma.visaSubmission.findFirst.mockResolvedValue(null);
      integrationsService.getCredentialConfig.mockResolvedValue({
        refundAgencyFeePercent: '5',
      });

      const preview = await service.previewRefund('app-1');

      expect(preview.supplierPenalty).toBe(0);
      expect(preview.agencyFee).toBe(2500);
      expect(preview.refundAmount).toBe(47500);
      expect(preview.alreadySubmittedToProvider).toBe(false);
    });

    it('forfeits the embassy/agent cost once the application has already been submitted', async () => {
      prisma.visaApplication.findUnique.mockResolvedValue({
        ...paidApplication,
      });
      prisma.visaSubmission.findFirst.mockResolvedValue({ id: 'sub-1' });
      integrationsService.getCredentialConfig.mockResolvedValue({
        refundAgencyFeePercent: '5',
      });

      const preview = await service.previewRefund('app-1');

      expect(preview.supplierPenalty).toBe(30000); // companyCostSnapshot
      expect(preview.agencyFee).toBe(2500);
      expect(preview.refundAmount).toBe(17500); // 50000 - 30000 - 2500
      expect(preview.alreadySubmittedToProvider).toBe(true);
    });

    it('never returns a negative refund even if penalties exceed the amount paid', async () => {
      prisma.visaApplication.findUnique.mockResolvedValue({
        ...paidApplication,
        totalAmount: 10000,
        companyCostSnapshot: 30000,
      });
      prisma.visaSubmission.findFirst.mockResolvedValue({ id: 'sub-1' });
      integrationsService.getCredentialConfig.mockResolvedValue({
        refundAgencyFeePercent: '5',
      });

      const preview = await service.previewRefund('app-1');

      expect(preview.refundAmount).toBe(0);
    });

    it('throws NotFound for a missing application', async () => {
      prisma.visaApplication.findUnique.mockResolvedValue(null);

      await expect(service.previewRefund('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws Forbidden when the application does not belong to the requesting customer', async () => {
      prisma.visaApplication.findUnique.mockResolvedValue({
        ...paidApplication,
      });

      await expect(
        service.previewRefund('app-1', 'someone-else'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('requestRefund', () => {
    beforeEach(() => {
      prisma.visaApplication.findUnique.mockResolvedValue({
        ...paidApplication,
      });
      prisma.visaSubmission.findFirst.mockResolvedValue(null);
      integrationsService.getCredentialConfig.mockResolvedValue({
        refundAgencyFeePercent: '5',
      });
      prisma.$transaction.mockResolvedValue([
        { id: 'refund-1', refundAmount: 47500, currency: 'NGN' },
        { id: 'app-1', status: VisaApplicationStatus.CANCELLED },
      ]);
      prisma.customer.findUnique.mockResolvedValue({
        identity: { email: 'amina@example.com', id: 'identity-1' },
      });
    });

    it('posts the refund to finance, cancels pending incentives, and notifies the customer', async () => {
      const result = await service.requestRefund('app-1', {
        requestedByStaffId: 'staff-1',
        reason: 'Trip cancelled',
      });

      expect(result).toEqual({
        id: 'refund-1',
        refundAmount: 47500,
        currency: 'NGN',
      });
      expect(financePostingService.postRefund).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 47500, sourceModule: 'VISA_REFUND' }),
      );
      expect(
        financePostingService.cancelIncentivesForSource,
      ).toHaveBeenCalledWith('VISA_APPLICATION', 'app-1', expect.any(String));
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'visa_refund.completed' }),
      );
      expect(notificationsService.sendGeneric).toHaveBeenCalled();
    });

    it('rejects a second refund on the same application', async () => {
      prisma.visaApplication.findUnique.mockResolvedValue({
        ...paidApplication,
        refund: { id: 'existing-refund' },
      });

      await expect(service.requestRefund('app-1', {})).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a refund when no payment has been verified', async () => {
      prisma.visaApplication.findUnique.mockResolvedValue({
        ...paidApplication,
        invoice: { status: InvoiceStatus.ISSUED },
      });

      await expect(service.requestRefund('app-1', {})).rejects.toThrow(
        ConflictException,
      );
    });

    it('skips the finance posting when the refund amount rounds to zero', async () => {
      prisma.visaApplication.findUnique.mockResolvedValue({
        ...paidApplication,
        totalAmount: 1000,
        companyCostSnapshot: 5000,
      });
      prisma.visaSubmission.findFirst.mockResolvedValue({ id: 'sub-1' }); // penalty forfeited
      prisma.$transaction.mockResolvedValue([
        { id: 'refund-1', refundAmount: 0, currency: 'NGN' },
        { id: 'app-1', status: VisaApplicationStatus.CANCELLED },
      ]);

      await service.requestRefund('app-1', {});

      expect(financePostingService.postRefund).not.toHaveBeenCalled();
    });
  });
});
