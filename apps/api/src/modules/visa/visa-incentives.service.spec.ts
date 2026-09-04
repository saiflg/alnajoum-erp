import { Test, TestingModule } from '@nestjs/testing';
import { IncentivePolicyType, IncentiveStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinancePostingService } from '../finance/finance-posting.service';
import { FinanceSettingsService } from '../finance/finance-settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  calculateStaffIncentiveAmount,
  VisaIncentivesService,
} from './visa-incentives.service';
import { ConflictException, ForbiddenException } from '@nestjs/common';

describe('calculateStaffIncentiveAmount (pure)', () => {
  it('returns 0 when there is no margin', () => {
    expect(
      calculateStaffIncentiveAmount(0, {
        type: IncentivePolicyType.FULL_MARGIN,
        config: {},
      }),
    ).toBe(0);
    expect(
      calculateStaffIncentiveAmount(-5000, {
        type: IncentivePolicyType.FULL_MARGIN,
        config: {},
      }),
    ).toBe(0);
  });

  it('returns 0 — never guesses — when no policy is configured at all', () => {
    expect(calculateStaffIncentiveAmount(200_000, null)).toBe(0);
  });

  it('FULL_MARGIN: 100% of margin, matching the spec example exactly', () => {
    // Company cost ₦600,000, selling price ₦800,000 -> margin ₦200,000 -> 100% -> ₦200,000
    const margin = 800_000 - 600_000;
    expect(
      calculateStaffIncentiveAmount(margin, {
        type: IncentivePolicyType.FULL_MARGIN,
        config: {},
      }),
    ).toBe(200_000);
  });

  it('PERCENT_OF_MARGIN: rounds to the nearest whole currency unit', () => {
    expect(
      calculateStaffIncentiveAmount(200_000, {
        type: IncentivePolicyType.PERCENT_OF_MARGIN,
        config: { percent: 33 },
      }),
    ).toBe(66_000);
  });

  it('FIXED_AMOUNT: capped at the margin so it never exceeds the actual profit', () => {
    expect(
      calculateStaffIncentiveAmount(50_000, {
        type: IncentivePolicyType.FIXED_AMOUNT,
        config: { amount: 80_000 },
      }),
    ).toBe(50_000);
    expect(
      calculateStaffIncentiveAmount(200_000, {
        type: IncentivePolicyType.FIXED_AMOUNT,
        config: { amount: 80_000 },
      }),
    ).toBe(80_000);
  });

  it('STAFF_COMPANY_SPLIT: uses only the staff share, the rest stays with the company implicitly', () => {
    expect(
      calculateStaffIncentiveAmount(200_000, {
        type: IncentivePolicyType.STAFF_COMPANY_SPLIT,
        config: { staffPercent: 70 },
      }),
    ).toBe(140_000);
  });

  it('STAFF_BRANCH_COMPANY_SPLIT: uses only the staff share', () => {
    expect(
      calculateStaffIncentiveAmount(200_000, {
        type: IncentivePolicyType.STAFF_BRANCH_COMPANY_SPLIT,
        config: { staffPercent: 60, branchPercent: 15 },
      }),
    ).toBe(120_000);
  });

  it('CUSTOM: behaves like PERCENT_OF_MARGIN or FIXED_AMOUNT depending on what config it carries', () => {
    expect(
      calculateStaffIncentiveAmount(200_000, {
        type: IncentivePolicyType.CUSTOM,
        config: { percent: 10 },
      }),
    ).toBe(20_000);
    expect(
      calculateStaffIncentiveAmount(200_000, {
        type: IncentivePolicyType.CUSTOM,
        config: { amount: 15_000 },
      }),
    ).toBe(15_000);
  });

  it('returns 0 for an incomplete config rather than guessing a number', () => {
    expect(
      calculateStaffIncentiveAmount(200_000, {
        type: IncentivePolicyType.PERCENT_OF_MARGIN,
        config: {},
      }),
    ).toBe(0);
    expect(
      calculateStaffIncentiveAmount(200_000, {
        type: IncentivePolicyType.STAFF_COMPANY_SPLIT,
        config: {},
      }),
    ).toBe(0);
  });
});

describe('VisaIncentivesService', () => {
  let service: VisaIncentivesService;
  let prisma: {
    visaService: { findUnique: jest.Mock };
    incentivePolicy: { findFirst: jest.Mock };
    staffIncentive: {
      findFirst: jest.Mock;
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    staff: { findUnique: jest.Mock };
  };
  let auditService: { record: jest.Mock };
  let notificationsService: { sendIncentiveUpdate: jest.Mock };

  const application = {
    id: 'app-1',
    applicationReference: 'VISA-2026-000001',
    currency: 'NGN',
    customerId: 'customer-1',
    visaServiceId: 'vs-1',
    assignedStaffId: 'staff-1',
    appliedByStaffId: null,
    companyCostSnapshot: 600_000,
    sellingPriceSnapshot: 800_000,
  };

  beforeEach(async () => {
    prisma = {
      visaService: { findUnique: jest.fn() },
      incentivePolicy: { findFirst: jest.fn() },
      staffIncentive: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      staff: { findUnique: jest.fn() },
    };
    auditService = { record: jest.fn() };
    notificationsService = { sendIncentiveUpdate: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VisaIncentivesService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
        { provide: NotificationsService, useValue: notificationsService },
        {
          provide: FinancePostingService,
          useValue: {
            postCostOfServiceForBooking: jest.fn(),
            postIncentiveApproved: jest.fn(),
          },
        },
        {
          provide: FinanceSettingsService,
          // High thresholds so the tier-gating (tested separately below)
          // doesn't interfere with these state-machine tests' 200_000 amount.
          useValue: {
            get: jest.fn().mockResolvedValue({
              payoutApprovalTier1Max: 1_000_000,
              payoutApprovalTier2Max: 5_000_000,
            }),
          },
        },
      ],
    }).compile();

    service = module.get(VisaIncentivesService);
  });

  describe('createForCompletedApplication', () => {
    it('creates a PENDING incentive using the service-level policy, and notifies the staff', async () => {
      prisma.visaService.findUnique.mockResolvedValue({
        incentivePolicy: {
          id: 'policy-1',
          isActive: true,
          type: 'FULL_MARGIN',
          config: {},
        },
      });
      prisma.staffIncentive.create.mockResolvedValue({
        id: 'inc-1',
        referenceNumber: 'INC-ABC123',
      });
      prisma.staff.findUnique.mockResolvedValue({
        identity: { id: 'staff-identity-1', email: 'staff@example.com' },
      });

      await service.createForCompletedApplication(application as never);

      expect(prisma.staffIncentive.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            staffId: 'staff-1',
            amount: 200_000,
            status: IncentiveStatus.PENDING,
            companyCost: 600_000,
            sellingPrice: 800_000,
            margin: 200_000,
          }),
        }),
      );
      expect(notificationsService.sendIncentiveUpdate).toHaveBeenCalledWith(
        'staff@example.com',
        'staff-identity-1',
        expect.objectContaining({ status: 'GENERATED' }),
      );
    });

    it('falls back to the platform default policy when the service has none', async () => {
      prisma.visaService.findUnique.mockResolvedValue({
        incentivePolicy: null,
      });
      prisma.incentivePolicy.findFirst.mockResolvedValue({
        id: 'default-policy',
        type: 'PERCENT_OF_MARGIN',
        config: { percent: 50 },
      });
      prisma.staffIncentive.create.mockResolvedValue({ id: 'inc-2' });
      prisma.staff.findUnique.mockResolvedValue(null);

      await service.createForCompletedApplication(application as never);

      expect(prisma.incentivePolicy.findFirst).toHaveBeenCalledWith({
        where: { isDefault: true, isActive: true },
      });
      expect(prisma.staffIncentive.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amount: 100_000 }),
        }),
      );
    });

    it('creates no incentive (and does not touch the DB write) when no policy resolves at all', async () => {
      prisma.visaService.findUnique.mockResolvedValue({
        incentivePolicy: null,
      });
      prisma.incentivePolicy.findFirst.mockResolvedValue(null);

      await service.createForCompletedApplication(application as never);

      expect(prisma.staffIncentive.create).not.toHaveBeenCalled();
    });

    it('is idempotent — does nothing if an incentive already exists for this application', async () => {
      prisma.staffIncentive.findFirst.mockResolvedValue({ id: 'existing-inc' });

      await service.createForCompletedApplication(application as never);

      expect(prisma.visaService.findUnique).not.toHaveBeenCalled();
      expect(prisma.staffIncentive.create).not.toHaveBeenCalled();
    });

    it('skips when there is no staff to credit (pure self-service, no assigned/applying staff)', async () => {
      await service.createForCompletedApplication({
        ...application,
        assignedStaffId: null,
        appliedByStaffId: null,
      } as never);

      expect(prisma.staffIncentive.create).not.toHaveBeenCalled();
    });

    it('skips when the application has no VisaService cost snapshot to compute a margin from', async () => {
      await service.createForCompletedApplication({
        ...application,
        companyCostSnapshot: null,
        sellingPriceSnapshot: null,
      } as never);

      expect(prisma.staffIncentive.create).not.toHaveBeenCalled();
    });
  });

  async function buildServiceWithThresholds(thresholds: {
    payoutApprovalTier1Max: number;
    payoutApprovalTier2Max: number;
  }): Promise<VisaIncentivesService> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VisaIncentivesService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
        { provide: NotificationsService, useValue: notificationsService },
        {
          provide: FinancePostingService,
          useValue: {
            postCostOfServiceForBooking: jest.fn(),
            postIncentiveApproved: jest.fn(),
          },
        },
        {
          provide: FinanceSettingsService,
          useValue: { get: jest.fn().mockResolvedValue(thresholds) },
        },
      ],
    }).compile();
    return module.get(VisaIncentivesService);
  }

  describe('approve / reject', () => {
    const pendingIncentive = {
      id: 'inc-1',
      staffId: 'staff-1',
      status: IncentiveStatus.PENDING,
      amount: 200_000,
      currency: 'NGN',
      referenceNumber: 'INC-ABC123',
    };

    beforeEach(() => {
      prisma.staffIncentive.findUnique.mockResolvedValue(pendingIncentive);
      prisma.staff.findUnique.mockResolvedValue({
        identity: { id: 'staff-identity-1', email: 'staff@example.com' },
      });
    });

    it('approves a PENDING incentive and notifies the staff member', async () => {
      prisma.staffIncentive.update.mockResolvedValue({
        ...pendingIncentive,
        status: IncentiveStatus.APPROVED,
      });

      await service.approve('inc-1', 'approver-1');

      expect(prisma.staffIncentive.update).toHaveBeenCalledWith({
        where: { id: 'inc-1' },
        data: expect.objectContaining({
          status: IncentiveStatus.APPROVED,
          approvedByStaffId: 'approver-1',
        }),
      });
      expect(notificationsService.sendIncentiveUpdate).toHaveBeenCalledWith(
        'staff@example.com',
        'staff-identity-1',
        expect.objectContaining({ status: 'APPROVED' }),
      );
    });

    it('rejects approving a non-PENDING incentive', async () => {
      prisma.staffIncentive.findUnique.mockResolvedValue({
        ...pendingIncentive,
        status: IncentiveStatus.PAID,
      });

      await expect(service.approve('inc-1', 'approver-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('spec #14: blocks approval above tier 1 without FINANCE.APPROVE_HIGH_VALUE', async () => {
      const highValueService = await buildServiceWithThresholds({
        payoutApprovalTier1Max: 100_000,
        payoutApprovalTier2Max: 500_000,
      });
      prisma.staffIncentive.findUnique.mockResolvedValue(pendingIncentive); // amount 200_000 > tier1Max
      await expect(
        highValueService.approve('inc-1', 'approver-1', []),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.staffIncentive.update).not.toHaveBeenCalled();
    });

    it('spec #14: allows approval above tier 1 when the actor holds FINANCE.APPROVE_HIGH_VALUE', async () => {
      const highValueService = await buildServiceWithThresholds({
        payoutApprovalTier1Max: 100_000,
        payoutApprovalTier2Max: 500_000,
      });
      prisma.staffIncentive.findUnique.mockResolvedValue(pendingIncentive);
      prisma.staffIncentive.update.mockResolvedValue({
        ...pendingIncentive,
        status: IncentiveStatus.APPROVED,
      });

      await highValueService.approve('inc-1', 'approver-1', [
        'finance:approve_high_value',
      ]);

      expect(prisma.staffIncentive.update).toHaveBeenCalled();
    });

    it('rejects a PENDING incentive with a reason', async () => {
      prisma.staffIncentive.update.mockResolvedValue({
        ...pendingIncentive,
        status: IncentiveStatus.REJECTED,
        rejectionReason: 'Duplicate application',
      });

      await service.reject('inc-1', 'Duplicate application', 'approver-1');

      expect(prisma.staffIncentive.update).toHaveBeenCalledWith({
        where: { id: 'inc-1' },
        data: {
          status: IncentiveStatus.REJECTED,
          rejectionReason: 'Duplicate application',
        },
      });
    });
  });
});
