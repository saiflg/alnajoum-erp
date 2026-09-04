import { Test, TestingModule } from '@nestjs/testing';
import {
  PilgrimType,
  ReadinessStatus,
  VisaApplicationStatus,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PilgrimLookupService } from './pilgrim-lookup.service';
import { ReadinessService } from './readiness.service';

describe('ReadinessService', () => {
  let service: ReadinessService;
  let prisma: Record<string, any>;
  let pilgrimLookup: { getPilgrim: jest.Mock };

  const basePilgrim = {
    id: 'pilgrim-1',
    customerId: 'customer-1',
    familyMemberId: null,
    registration: {
      invoice: { totalAmount: 1000, payments: [{ amount: 1000 }] },
    },
  };

  beforeEach(async () => {
    prisma = {
      customerDocument: { findMany: jest.fn().mockResolvedValue([]) },
      familyMemberDocument: { findMany: jest.fn().mockResolvedValue([]) },
      visaApplication: { findFirst: jest.fn().mockResolvedValue(null) },
      flightBookingPassenger: { count: jest.fn().mockResolvedValue(0) },
      hotelBookingGuest: { count: jest.fn().mockResolvedValue(0) },
      pilgrimReadinessOverride: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      hajjRegistrationPilgrim: { findMany: jest.fn().mockResolvedValue([]) },
      umrahRegistrationPilgrim: { findMany: jest.fn().mockResolvedValue([]) },
    };
    pilgrimLookup = { getPilgrim: jest.fn().mockResolvedValue(basePilgrim) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReadinessService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { record: jest.fn() } },
        { provide: PilgrimLookupService, useValue: pilgrimLookup },
      ],
    }).compile();

    service = module.get(ReadinessService);
  });

  describe('compute (spec #3, #28-#30)', () => {
    it('is RED when required documents are missing, even if everything else is ready', async () => {
      prisma.customerDocument.findMany.mockResolvedValue([
        { type: 'PASSPORT' },
      ]); // missing PHOTO, VACCINATION_CERTIFICATE

      const result = await service.compute(PilgrimType.HAJJ, 'pilgrim-1');

      expect(result.documentsComplete).toBe(false);
      expect(result.missingDocuments).toEqual([
        'PHOTO',
        'VACCINATION_CERTIFICATE',
      ]);
      expect(result.computedStatus).toBe(ReadinessStatus.RED);
      expect(result.finalStatus).toBe(ReadinessStatus.RED);
    });

    it('is RED when the invoice has an outstanding balance, regardless of documents', async () => {
      prisma.customerDocument.findMany.mockResolvedValue([
        { type: 'PASSPORT' },
        { type: 'PHOTO' },
        { type: 'VACCINATION_CERTIFICATE' },
      ]);
      pilgrimLookup.getPilgrim.mockResolvedValue({
        ...basePilgrim,
        registration: {
          invoice: { totalAmount: 1000, payments: [{ amount: 400 }] },
        },
      });

      const result = await service.compute(PilgrimType.HAJJ, 'pilgrim-1');

      expect(result.paymentComplete).toBe(false);
      expect(result.outstandingAmount).toBe(600);
      expect(result.computedStatus).toBe(ReadinessStatus.RED);
    });

    it('is AMBER when documents+payment are complete but visa/flight/hotel are not yet confirmed', async () => {
      prisma.customerDocument.findMany.mockResolvedValue([
        { type: 'PASSPORT' },
        { type: 'PHOTO' },
        { type: 'VACCINATION_CERTIFICATE' },
      ]);

      const result = await service.compute(PilgrimType.HAJJ, 'pilgrim-1');

      expect(result.documentsComplete).toBe(true);
      expect(result.paymentComplete).toBe(true);
      expect(result.visaStatus).toBe('NOT_APPLIED');
      expect(result.computedStatus).toBe(ReadinessStatus.AMBER);
    });

    it('is GREEN only when documents, payment, visa, flight, and hotel are all confirmed', async () => {
      prisma.customerDocument.findMany.mockResolvedValue([
        { type: 'PASSPORT' },
        { type: 'PHOTO' },
        { type: 'VACCINATION_CERTIFICATE' },
      ]);
      prisma.visaApplication.findFirst.mockResolvedValue({
        status: VisaApplicationStatus.APPROVED,
      });
      prisma.flightBookingPassenger.count.mockResolvedValue(1);
      prisma.hotelBookingGuest.count.mockResolvedValue(1);

      const result = await service.compute(PilgrimType.HAJJ, 'pilgrim-1');

      expect(result.computedStatus).toBe(ReadinessStatus.GREEN);
      expect(result.finalStatus).toBe(ReadinessStatus.GREEN);
    });

    it('finalStatus reflects an active manual override even though computedStatus stays the live-data value', async () => {
      prisma.pilgrimReadinessOverride.findFirst.mockResolvedValue({
        status: ReadinessStatus.GREEN,
        reason: 'Documents verified in person, system upload pending',
        overriddenAt: new Date(),
      });

      const result = await service.compute(PilgrimType.HAJJ, 'pilgrim-1');

      // Documents are missing (0 uploaded) so the live computation is RED...
      expect(result.computedStatus).toBe(ReadinessStatus.RED);
      // ...but the override is what staff/pilgrims actually see.
      expect(result.finalStatus).toBe(ReadinessStatus.GREEN);
      expect(result.override?.reason).toContain('Documents verified');
    });
  });

  describe('setOverride (spec #30 — authorized, audited manual override)', () => {
    it('persists the override and records an audit entry', async () => {
      prisma.pilgrimReadinessOverride.create.mockResolvedValue({
        id: 'override-1',
      });
      const auditService = { record: jest.fn() };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ReadinessService,
          { provide: PrismaService, useValue: prisma },
          { provide: AuditService, useValue: auditService },
          { provide: PilgrimLookupService, useValue: pilgrimLookup },
        ],
      }).compile();
      const svc = module.get(ReadinessService);

      await svc.setOverride(
        PilgrimType.HAJJ,
        'pilgrim-1',
        ReadinessStatus.AMBER,
        'Payment confirmed via bank, awaiting reconciliation',
        'staff-1',
      );

      expect(prisma.pilgrimReadinessOverride.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            pilgrimType: PilgrimType.HAJJ,
            pilgrimId: 'pilgrim-1',
            status: ReadinessStatus.AMBER,
            overriddenByStaffId: 'staff-1',
          }),
        }),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'pilgrim_readiness.overridden' }),
      );
    });
  });
});
