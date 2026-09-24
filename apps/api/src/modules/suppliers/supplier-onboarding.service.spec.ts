import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ApprovalRequestStatus,
  SupplierOnboardingStatus,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ApprovalsService } from '../governance/approvals.service';
import { SupplierOnboardingService } from './supplier-onboarding.service';

// @nestjs/schedule ships an ESM build Jest's default transform can't parse —
// same workaround as flight-refunds.service.spec.ts.
jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => undefined,
  CronExpression: { EVERY_5_MINUTES: '*/5 * * * *' },
}));

describe('SupplierOnboardingService', () => {
  let service: SupplierOnboardingService;
  let prisma: {
    supplier: { findUnique: jest.Mock; update: jest.Mock; findMany: jest.Mock };
    approvalRequest: { findMany: jest.Mock };
  };
  let auditService: { record: jest.Mock };
  let approvalsService: { createRequest: jest.Mock };

  beforeEach(async () => {
    prisma = {
      supplier: {
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      approvalRequest: { findMany: jest.fn() },
    };
    auditService = { record: jest.fn() };
    approvalsService = {
      createRequest: jest
        .fn()
        .mockResolvedValue({ id: 'approval-1', requiredApprovals: 1 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupplierOnboardingService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
        { provide: ApprovalsService, useValue: approvalsService },
      ],
    }).compile();

    service = module.get(SupplierOnboardingService);
  });

  describe('transition', () => {
    it('throws NotFound for a missing supplier', async () => {
      prisma.supplier.findUnique.mockResolvedValue(null);

      await expect(
        service.transition(
          'missing',
          SupplierOnboardingStatus.INVITED,
          undefined,
          'identity-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFound for a cross-tenant supplier', async () => {
      prisma.supplier.findUnique.mockResolvedValue({
        id: 'sup-1',
        companyId: 'company-b',
        onboardingStatus: SupplierOnboardingStatus.DRAFT,
      });

      await expect(
        service.transition(
          'sup-1',
          SupplierOnboardingStatus.INVITED,
          'company-a',
          'identity-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('allows the next forward step', async () => {
      prisma.supplier.findUnique.mockResolvedValue({
        id: 'sup-1',
        companyId: 'company-a',
        onboardingStatus: SupplierOnboardingStatus.DRAFT,
      });
      prisma.supplier.update.mockResolvedValue({
        id: 'sup-1',
        onboardingStatus: SupplierOnboardingStatus.INVITED,
      });

      await service.transition(
        'sup-1',
        SupplierOnboardingStatus.INVITED,
        'company-a',
        'identity-1',
      );

      expect(prisma.supplier.update).toHaveBeenCalledWith({
        where: { id: 'sup-1' },
        data: { onboardingStatus: SupplierOnboardingStatus.INVITED },
      });
    });

    it('rejects skipping a stage', async () => {
      prisma.supplier.findUnique.mockResolvedValue({
        id: 'sup-1',
        companyId: 'company-a',
        onboardingStatus: SupplierOnboardingStatus.DRAFT,
      });

      await expect(
        service.transition(
          'sup-1',
          SupplierOnboardingStatus.KYC_REVIEW, // skips INVITED, INFORMATION_SUBMITTED
          'company-a',
          'identity-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.supplier.update).not.toHaveBeenCalled();
    });

    it('rejects moving backward', async () => {
      prisma.supplier.findUnique.mockResolvedValue({
        id: 'sup-1',
        companyId: 'company-a',
        onboardingStatus: SupplierOnboardingStatus.FINANCE_REVIEW,
      });

      await expect(
        service.transition(
          'sup-1',
          SupplierOnboardingStatus.DOCUMENT_REVIEW,
          'company-a',
          'identity-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('opens a real ApprovalRequest when entering ADMIN_APPROVAL, rather than just flipping the status', async () => {
      prisma.supplier.findUnique.mockResolvedValue({
        id: 'sup-1',
        companyId: 'company-a',
        onboardingStatus: SupplierOnboardingStatus.FINANCE_REVIEW,
      });
      prisma.supplier.update.mockResolvedValue({
        id: 'sup-1',
        onboardingStatus: SupplierOnboardingStatus.ADMIN_APPROVAL,
      });

      await service.transition(
        'sup-1',
        SupplierOnboardingStatus.ADMIN_APPROVAL,
        'company-a',
        'identity-1',
        'Ready for sign-off',
      );

      expect(approvalsService.createRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SUPPLIER_ACTIVATION',
          entityType: 'Supplier',
          entityId: 'sup-1',
          requestedByIdentityId: 'identity-1',
          companyId: 'company-a',
          reason: 'Ready for sign-off',
        }),
      );
    });

    it('REJECTS a direct ADMIN_APPROVAL -> ACTIVE move — only the approval sweep may do that', async () => {
      prisma.supplier.findUnique.mockResolvedValue({
        id: 'sup-1',
        companyId: 'company-a',
        onboardingStatus: SupplierOnboardingStatus.ADMIN_APPROVAL,
      });

      await expect(
        service.transition(
          'sup-1',
          SupplierOnboardingStatus.ACTIVE,
          'company-a',
          'identity-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.supplier.update).not.toHaveBeenCalled();
    });

    it('allows suspending an ACTIVE supplier and reactivating it', async () => {
      prisma.supplier.findUnique.mockResolvedValue({
        id: 'sup-1',
        companyId: 'company-a',
        onboardingStatus: SupplierOnboardingStatus.ACTIVE,
      });
      prisma.supplier.update.mockResolvedValue({});

      await service.transition(
        'sup-1',
        SupplierOnboardingStatus.SUSPENDED,
        'company-a',
        'identity-1',
      );

      expect(prisma.supplier.update).toHaveBeenCalledWith({
        where: { id: 'sup-1' },
        data: { onboardingStatus: SupplierOnboardingStatus.SUSPENDED },
      });
    });

    it('allows TERMINATED from almost any state, but never from TERMINATED itself', async () => {
      prisma.supplier.findUnique.mockResolvedValue({
        id: 'sup-1',
        companyId: 'company-a',
        onboardingStatus: SupplierOnboardingStatus.TERMINATED,
      });

      await expect(
        service.transition(
          'sup-1',
          SupplierOnboardingStatus.TERMINATED,
          'company-a',
          'identity-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('runApprovalSweep', () => {
    it('activates a supplier whose approval request was APPROVED', async () => {
      prisma.approvalRequest.findMany.mockResolvedValue([
        { status: ApprovalRequestStatus.APPROVED, entityId: 'sup-1' },
      ]);
      prisma.supplier.findMany.mockResolvedValue([{ id: 'sup-1' }]);
      prisma.supplier.update.mockResolvedValue({});

      const result = await service.runApprovalSweep();

      expect(prisma.supplier.update).toHaveBeenCalledWith({
        where: { id: 'sup-1' },
        data: { onboardingStatus: SupplierOnboardingStatus.ACTIVE },
      });
      expect(result).toEqual({
        considered: 1,
        activated: 1,
        bouncedBack: 0,
        failed: 0,
      });
    });

    it('bounces a REJECTED supplier back to FINANCE_REVIEW, not TERMINATED', async () => {
      prisma.approvalRequest.findMany.mockResolvedValue([
        { status: ApprovalRequestStatus.REJECTED, entityId: 'sup-1' },
      ]);
      prisma.supplier.findMany.mockResolvedValue([{ id: 'sup-1' }]);
      prisma.supplier.update.mockResolvedValue({});

      const result = await service.runApprovalSweep();

      expect(prisma.supplier.update).toHaveBeenCalledWith({
        where: { id: 'sup-1' },
        data: { onboardingStatus: SupplierOnboardingStatus.FINANCE_REVIEW },
      });
      expect(result.bouncedBack).toBe(1);
    });

    it('ignores a resolved request whose supplier already moved past ADMIN_APPROVAL (already processed)', async () => {
      prisma.approvalRequest.findMany.mockResolvedValue([
        { status: ApprovalRequestStatus.APPROVED, entityId: 'sup-1' },
      ]);
      prisma.supplier.findMany.mockResolvedValue([]); // not in ADMIN_APPROVAL anymore

      const result = await service.runApprovalSweep();

      expect(prisma.supplier.update).not.toHaveBeenCalled();
      expect(result.considered).toBe(0);
    });

    it("one failing update doesn't stop the rest of the batch", async () => {
      prisma.approvalRequest.findMany.mockResolvedValue([
        { status: ApprovalRequestStatus.APPROVED, entityId: 'sup-1' },
        { status: ApprovalRequestStatus.APPROVED, entityId: 'sup-2' },
      ]);
      prisma.supplier.findMany.mockResolvedValue([
        { id: 'sup-1' },
        { id: 'sup-2' },
      ]);
      prisma.supplier.update
        .mockRejectedValueOnce(new Error('db down'))
        .mockResolvedValueOnce({});

      const result = await service.runApprovalSweep();

      expect(result).toEqual({
        considered: 2,
        activated: 1,
        bouncedBack: 0,
        failed: 1,
      });
    });
  });
});
