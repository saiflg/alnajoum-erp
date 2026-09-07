import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ApprovalDecisionType, ApprovalRequestStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ApprovalsService } from './approvals.service';

describe('ApprovalsService', () => {
  let service: ApprovalsService;
  let prisma: {
    approvalThresholdRule: { findMany: jest.Mock };
    approvalRequest: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
    approvalDecision: { create: jest.Mock };
  };
  let auditService: { record: jest.Mock };

  beforeEach(async () => {
    prisma = {
      approvalThresholdRule: { findMany: jest.fn().mockResolvedValue([]) },
      approvalRequest: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      approvalDecision: { create: jest.fn() },
    };
    auditService = { record: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApprovalsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get(ApprovalsService);
  });

  describe('resolveRequiredApprovals', () => {
    it('defaults to 1 when no amount is given', async () => {
      await expect(
        service.resolveRequiredApprovals('FLIGHT_REFUND', undefined),
      ).resolves.toBe(1);
    });

    it('defaults to 1 when no threshold rule matches', async () => {
      prisma.approvalThresholdRule.findMany.mockResolvedValue([]);

      await expect(
        service.resolveRequiredApprovals('FLIGHT_REFUND', 500_000),
      ).resolves.toBe(1);
    });

    it("uses the matching platform-wide rule's requiredApprovals", async () => {
      prisma.approvalThresholdRule.findMany.mockResolvedValue([
        { companyId: null, requiredApprovals: 2 },
      ]);

      await expect(
        service.resolveRequiredApprovals('FLIGHT_REFUND', 500_000),
      ).resolves.toBe(2);
    });

    it('prefers a company-scoped rule over the platform-wide default', async () => {
      prisma.approvalThresholdRule.findMany.mockResolvedValue([
        { companyId: null, requiredApprovals: 1 },
        { companyId: 'company-a', requiredApprovals: 3 },
      ]);

      await expect(
        service.resolveRequiredApprovals('FLIGHT_REFUND', 500_000, 'company-a'),
      ).resolves.toBe(3);
    });
  });

  describe('createRequest', () => {
    it('resolves requiredApprovals and creates the request', async () => {
      prisma.approvalThresholdRule.findMany.mockResolvedValue([
        { companyId: null, requiredApprovals: 2 },
      ]);
      prisma.approvalRequest.create.mockResolvedValue({ id: 'req-1' });

      await service.createRequest({
        type: 'FLIGHT_REFUND',
        amount: 500_000,
        requestedByIdentityId: 'requester-1',
      });

      expect(prisma.approvalRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ requiredApprovals: 2 }),
        }),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'approval.requested' }),
      );
    });
  });

  describe('findOne', () => {
    it('throws NotFound for a cross-tenant request id', async () => {
      prisma.approvalRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        companyId: 'company-b',
      });

      await expect(service.findOne('req-1', 'company-a')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('decide', () => {
    const pendingRequest = {
      id: 'req-1',
      status: ApprovalRequestStatus.REQUESTED,
      requestedByIdentityId: 'requester-1',
      requiredApprovals: 1,
      companyId: null,
      decisions: [],
    };

    it('prevents self-approval', async () => {
      prisma.approvalRequest.findUnique.mockResolvedValue(pendingRequest);

      await expect(
        service.decide(
          'req-1',
          'requester-1',
          ApprovalDecisionType.APPROVED,
          undefined,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.approvalDecision.create).not.toHaveBeenCalled();
    });

    it('requires a reason to reject', async () => {
      prisma.approvalRequest.findUnique.mockResolvedValue(pendingRequest);

      await expect(
        service.decide(
          'req-1',
          'approver-1',
          ApprovalDecisionType.REJECTED,
          undefined,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a decision on an already-resolved request', async () => {
      prisma.approvalRequest.findUnique.mockResolvedValue({
        ...pendingRequest,
        status: ApprovalRequestStatus.APPROVED,
      });

      await expect(
        service.decide(
          'req-1',
          'approver-1',
          ApprovalDecisionType.APPROVED,
          undefined,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a second decision from the same approver', async () => {
      prisma.approvalRequest.findUnique.mockResolvedValue({
        ...pendingRequest,
        decisions: [
          { decidedByIdentityId: 'approver-1', decision: 'APPROVED' },
        ],
      });

      await expect(
        service.decide(
          'req-1',
          'approver-1',
          ApprovalDecisionType.APPROVED,
          undefined,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('flips to APPROVED once requiredApprovals is met', async () => {
      prisma.approvalRequest.findUnique.mockResolvedValue(pendingRequest);
      prisma.approvalRequest.update.mockResolvedValue({
        ...pendingRequest,
        status: ApprovalRequestStatus.APPROVED,
      });

      await service.decide(
        'req-1',
        'approver-1',
        ApprovalDecisionType.APPROVED,
        undefined,
      );

      expect(prisma.approvalRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ApprovalRequestStatus.APPROVED,
            resolvedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('moves to UNDER_REVIEW (not APPROVED) when more approvals are still needed', async () => {
      prisma.approvalRequest.findUnique.mockResolvedValue({
        ...pendingRequest,
        requiredApprovals: 2,
      });
      prisma.approvalRequest.update.mockResolvedValue({});

      await service.decide(
        'req-1',
        'approver-1',
        ApprovalDecisionType.APPROVED,
        undefined,
      );

      expect(prisma.approvalRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ApprovalRequestStatus.UNDER_REVIEW,
            resolvedAt: null,
          }),
        }),
      );
    });

    it('stops the request immediately on a single rejection, regardless of requiredApprovals', async () => {
      prisma.approvalRequest.findUnique.mockResolvedValue({
        ...pendingRequest,
        requiredApprovals: 3,
      });
      prisma.approvalRequest.update.mockResolvedValue({});

      await service.decide(
        'req-1',
        'approver-1',
        ApprovalDecisionType.REJECTED,
        'Not justified',
      );

      expect(prisma.approvalRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ApprovalRequestStatus.REJECTED,
          }),
        }),
      );
    });
  });
});
