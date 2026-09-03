import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { IncentiveStatus, PayoutStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { STAFF_PAYOUT_PROVIDER } from './providers/staff-payout-provider.port';
import { StaffPayoutsService } from './staff-payouts.service';

describe('StaffPayoutsService', () => {
  let service: StaffPayoutsService;
  let prisma: {
    staffIncentive: { findUnique: jest.Mock; update: jest.Mock };
    staffPayout: { upsert: jest.Mock; update: jest.Mock; findMany: jest.Mock };
    staff: { findUnique: jest.Mock };
    identity: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let provider: { sendPayout: jest.Mock };
  let notificationsService: { sendIncentiveUpdate: jest.Mock; sendGeneric: jest.Mock };

  const staffWithBankDetails = {
    id: 'staff-1',
    firstName: 'Musa',
    lastName: 'Bello',
    bankName: 'GTBank',
    bankAccountNumber: '0123456789',
    bankAccountName: 'Musa Bello',
  };

  const approvedIncentive = {
    id: 'inc-1',
    staffId: 'staff-1',
    amount: 200_000,
    currency: 'NGN',
    status: IncentiveStatus.APPROVED,
    referenceNumber: 'INC-ABC123',
    staff: staffWithBankDetails,
    payout: null,
  };

  beforeEach(async () => {
    prisma = {
      staffIncentive: { findUnique: jest.fn(), update: jest.fn() },
      staffPayout: { upsert: jest.fn(), update: jest.fn(), findMany: jest.fn() },
      staff: { findUnique: jest.fn() },
      identity: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    provider = { sendPayout: jest.fn() };
    notificationsService = { sendIncentiveUpdate: jest.fn(), sendGeneric: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StaffPayoutsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { record: jest.fn() } },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: STAFF_PAYOUT_PROVIDER, useValue: provider },
      ],
    }).compile();

    service = module.get(StaffPayoutsService);

    prisma.staffIncentive.findUnique.mockResolvedValue(approvedIncentive);
    prisma.staffPayout.upsert.mockResolvedValue({ id: 'payout-1', status: PayoutStatus.PENDING });
    prisma.staff.findUnique.mockResolvedValue({
      identity: { id: 'staff-identity-1', email: 'staff@example.com' },
    });
  });

  describe('attemptPayout', () => {
    it('marks the payout SUCCESSFUL and the incentive PAID on a successful provider response', async () => {
      provider.sendPayout.mockResolvedValue({ success: true, providerReference: 'MOCKPAY-1' });
      prisma.staffPayout.update.mockResolvedValue({ id: 'payout-1', status: PayoutStatus.SUCCESSFUL });

      const result = await service.attemptPayout('inc-1', 'requester-1');

      expect(provider.sendPayout).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 200_000,
          bankAccountNumber: '0123456789',
        }),
      );
      expect(prisma.staffPayout.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'payout-1' },
          data: expect.objectContaining({ status: PayoutStatus.SUCCESSFUL, providerReference: 'MOCKPAY-1' }),
        }),
      );
      expect(prisma.staffIncentive.update).toHaveBeenCalledWith({
        where: { id: 'inc-1' },
        data: { status: IncentiveStatus.PAID },
      });
      expect(notificationsService.sendIncentiveUpdate).toHaveBeenCalledWith(
        'staff@example.com',
        'staff-identity-1',
        expect.objectContaining({ status: 'PAID' }),
      );
      expect(result.status).toBe(PayoutStatus.SUCCESSFUL);
    });

    it('marks the payout FAILED and leaves the incentive APPROVED (payable again) on a provider failure', async () => {
      provider.sendPayout.mockResolvedValue({ success: false, errorMessage: 'Account could not be verified' });
      prisma.staffPayout.update.mockResolvedValue({
        id: 'payout-1',
        status: PayoutStatus.FAILED,
        providerError: 'Account could not be verified',
      });

      const result = await service.attemptPayout('inc-1', 'requester-1');

      expect(prisma.staffPayout.update).toHaveBeenCalledWith({
        where: { id: 'payout-1' },
        data: { status: PayoutStatus.FAILED, providerError: 'Account could not be verified' },
      });
      // The money is never deducted on failure — no incentive status change at all.
      expect(prisma.staffIncentive.update).not.toHaveBeenCalled();
      expect(result.status).toBe(PayoutStatus.FAILED);
    });

    it('throws BadRequest when the staff member has no bank details on file', async () => {
      prisma.staffIncentive.findUnique.mockResolvedValue({
        ...approvedIncentive,
        staff: { ...staffWithBankDetails, bankAccountNumber: null },
      });

      await expect(service.attemptPayout('inc-1', 'requester-1')).rejects.toThrow(BadRequestException);
      expect(provider.sendPayout).not.toHaveBeenCalled();
    });

    it('throws Conflict when the incentive is not APPROVED', async () => {
      prisma.staffIncentive.findUnique.mockResolvedValue({
        ...approvedIncentive,
        status: IncentiveStatus.PENDING,
      });

      await expect(service.attemptPayout('inc-1', 'requester-1')).rejects.toThrow(ConflictException);
    });

    it('throws Conflict when the incentive has already been successfully paid out', async () => {
      prisma.staffIncentive.findUnique.mockResolvedValue({
        ...approvedIncentive,
        payout: { status: PayoutStatus.SUCCESSFUL },
      });

      await expect(service.attemptPayout('inc-1', 'requester-1')).rejects.toThrow(ConflictException);
    });

    it('throws NotFound for a missing incentive', async () => {
      prisma.staffIncentive.findUnique.mockResolvedValue(null);

      await expect(service.attemptPayout('missing', 'requester-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('retryPayout', () => {
    it('reuses the same payout row via upsert rather than creating a second one', async () => {
      provider.sendPayout.mockResolvedValue({ success: true, providerReference: 'MOCKPAY-2' });
      prisma.staffPayout.update.mockResolvedValue({ id: 'payout-1', status: PayoutStatus.SUCCESSFUL });

      await service.retryPayout('inc-1', 'requester-1');

      expect(prisma.staffPayout.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { incentiveId: 'inc-1' } }),
      );
    });
  });
});
