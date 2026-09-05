import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { VisaTimelineService } from './visa-timeline.service';

describe('VisaTimelineService', () => {
  let service: VisaTimelineService;
  let prisma: {
    visaApplication: { findUnique: jest.Mock };
    auditLog: { findMany: jest.Mock };
    visaProviderMessage: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      visaApplication: { findUnique: jest.fn() },
      auditLog: { findMany: jest.fn().mockResolvedValue([]) },
      visaProviderMessage: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VisaTimelineService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(VisaTimelineService);
  });

  it('throws NotFound for a missing application', async () => {
    prisma.visaApplication.findUnique.mockResolvedValue(null);

    await expect(service.getTimeline('missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('queries audit logs across the application and every related entity discovered from its relations', async () => {
    prisma.visaApplication.findUnique.mockResolvedValue({
      id: 'app-1',
      documents: [{ id: 'doc-1' }, { id: 'doc-2' }],
      guarantor: { id: 'g-1' },
      submissions: [{ id: 'sub-1' }],
      refund: { id: 'refund-1' },
    });

    await service.getTimeline('app-1');

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { entityType: 'VisaApplication', entityId: 'app-1' },
            { entityType: 'Guarantor', entityId: 'g-1' },
            { entityType: 'VisaDocument', entityId: 'doc-1' },
            { entityType: 'VisaDocument', entityId: 'doc-2' },
            { entityType: 'VisaSubmission', entityId: 'sub-1' },
            { entityType: 'VisaRefund', entityId: 'refund-1' },
          ],
        },
      }),
    );
  });

  it('omits guarantor/refund filters when the application has neither', async () => {
    prisma.visaApplication.findUnique.mockResolvedValue({
      id: 'app-1',
      documents: [],
      guarantor: null,
      submissions: [],
      refund: null,
    });

    await service.getTimeline('app-1');

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ entityType: 'VisaApplication', entityId: 'app-1' }] },
      }),
    );
  });

  it('merges audit entries and provider messages into one timeline, sorted chronologically', async () => {
    prisma.visaApplication.findUnique.mockResolvedValue({
      id: 'app-1',
      documents: [],
      guarantor: null,
      submissions: [],
      refund: null,
    });
    prisma.auditLog.findMany.mockResolvedValue([
      {
        createdAt: new Date('2026-01-03'),
        action: 'visa_submission.created',
        entityType: 'VisaApplication',
        entityId: 'app-1',
        metadata: {},
        identity: { email: 'staff@example.com' },
      },
    ]);
    prisma.visaProviderMessage.findMany.mockResolvedValue([
      {
        createdAt: new Date('2026-01-02'),
        message: 'Application received',
        severity: 'INFO',
        acknowledgedByStaffId: null,
        acknowledgedAt: null,
      },
    ]);

    const timeline = await service.getTimeline('app-1');

    expect(timeline).toHaveLength(2);
    expect(timeline[0].source).toBe('provider_message'); // earlier timestamp comes first
    expect(timeline[0].detail).toBe('Application received');
    expect(timeline[1].source).toBe('audit');
    expect(timeline[1].actorEmail).toBe('staff@example.com');
  });
});
