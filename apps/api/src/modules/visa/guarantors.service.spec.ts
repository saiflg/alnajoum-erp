import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ApprovalStatus,
  VerificationStatus,
  VisaApplicationStatus,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GuarantorsService } from './guarantors.service';

describe('GuarantorsService', () => {
  let service: GuarantorsService;
  let prisma: {
    visaApplication: { findUnique: jest.Mock; update: jest.Mock };
    guarantor: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock; findMany: jest.Mock };
  };
  let auditService: { record: jest.Mock };
  let notificationsService: { sendGuarantorUpdate: jest.Mock };

  beforeEach(async () => {
    prisma = {
      visaApplication: { findUnique: jest.fn(), update: jest.fn() },
      guarantor: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
    };
    auditService = { record: jest.fn() };
    notificationsService = { sendGuarantorUpdate: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GuarantorsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get(GuarantorsService);
  });

  describe('attachToApplication', () => {
    it('creates the guarantor and moves the application to GUARANTOR_VERIFICATION', async () => {
      prisma.visaApplication.findUnique.mockResolvedValue({ id: 'app-1', guarantorId: null });
      prisma.guarantor.create.mockResolvedValue({ id: 'g-1' });

      await service.attachToApplication('app-1', {
        fullName: 'Yusuf Abdullahi',
        phone: '08010000000',
        relationship: 'Spouse',
      });

      expect(prisma.visaApplication.update).toHaveBeenCalledWith({
        where: { id: 'app-1' },
        data: { guarantorId: 'g-1', status: VisaApplicationStatus.GUARANTOR_VERIFICATION },
      });
    });

    it('throws NotFound for a missing application', async () => {
      prisma.visaApplication.findUnique.mockResolvedValue(null);

      await expect(
        service.attachToApplication('missing', {
          fullName: 'X',
          phone: '1',
          relationship: 'Friend',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects attaching a second guarantor to the same application', async () => {
      prisma.visaApplication.findUnique.mockResolvedValue({ id: 'app-1', guarantorId: 'g-existing' });

      await expect(
        service.attachToApplication('app-1', {
          fullName: 'X',
          phone: '1',
          relationship: 'Friend',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('verify', () => {
    const guarantorRow = {
      id: 'g-1',
      application: { id: 'app-1' },
    };

    beforeEach(() => {
      prisma.guarantor.findUnique.mockResolvedValue(guarantorRow);
      prisma.visaApplication.findUnique.mockResolvedValue({
        id: 'app-1',
        applicationReference: 'VISA-2026-000001',
        customer: { identity: { id: 'identity-1', email: 'amina@example.com' } },
      });
    });

    it('verified + approved advances the application to PAYMENT_PENDING and notifies the customer', async () => {
      prisma.guarantor.update.mockResolvedValue({
        verificationStatus: VerificationStatus.VERIFIED,
        approvalStatus: ApprovalStatus.APPROVED,
        verificationNote: 'Confirmed by phone',
      });

      await service.verify(
        'g-1',
        { verificationStatus: VerificationStatus.VERIFIED, approvalStatus: ApprovalStatus.APPROVED },
        'staff-1',
      );

      expect(prisma.visaApplication.update).toHaveBeenCalledWith({
        where: { id: 'app-1' },
        data: { status: VisaApplicationStatus.PAYMENT_PENDING },
      });
      expect(notificationsService.sendGuarantorUpdate).toHaveBeenCalledWith(
        'amina@example.com',
        'identity-1',
        expect.objectContaining({ approved: true }),
      );
    });

    it('rejection sends the application back to AWAITING_GUARANTOR and clears guarantorId', async () => {
      prisma.guarantor.update.mockResolvedValue({
        verificationStatus: VerificationStatus.REJECTED,
        approvalStatus: ApprovalStatus.REJECTED,
        verificationNote: 'Could not verify identity',
      });

      await service.verify(
        'g-1',
        { verificationStatus: VerificationStatus.REJECTED, approvalStatus: ApprovalStatus.REJECTED },
        'staff-1',
      );

      expect(prisma.visaApplication.update).toHaveBeenCalledWith({
        where: { id: 'app-1' },
        data: { status: VisaApplicationStatus.AWAITING_GUARANTOR, guarantorId: null },
      });
      expect(notificationsService.sendGuarantorUpdate).toHaveBeenCalledWith(
        'amina@example.com',
        'identity-1',
        expect.objectContaining({ approved: false }),
      );
    });

    it('a partial verification (still PENDING approval) does not move the application or notify yet', async () => {
      prisma.guarantor.update.mockResolvedValue({
        verificationStatus: VerificationStatus.VERIFIED,
        approvalStatus: ApprovalStatus.PENDING,
      });

      await service.verify(
        'g-1',
        { verificationStatus: VerificationStatus.VERIFIED },
        'staff-1',
      );

      expect(prisma.visaApplication.update).not.toHaveBeenCalled();
      expect(notificationsService.sendGuarantorUpdate).not.toHaveBeenCalled();
    });

    it('throws NotFound for a missing guarantor', async () => {
      prisma.guarantor.findUnique.mockResolvedValue(null);

      await expect(
        service.verify('missing', { approvalStatus: ApprovalStatus.APPROVED }, 'staff-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
