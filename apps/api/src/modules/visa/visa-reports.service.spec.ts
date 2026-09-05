import { Test, TestingModule } from '@nestjs/testing';
import { VisaApplicationStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { VisaReportsService } from './visa-reports.service';

describe('VisaReportsService', () => {
  let service: VisaReportsService;
  let prisma: { visaApplication: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = { visaApplication: { findMany: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VisaReportsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(VisaReportsService);
  });

  describe('statusBreakdown', () => {
    it('counts every VisaApplicationStatus value, including those with zero applications', async () => {
      prisma.visaApplication.findMany.mockResolvedValue([
        {
          status: VisaApplicationStatus.DRAFT,
          appliedByStaff: null,
          assignedStaff: null,
        },
        {
          status: VisaApplicationStatus.DRAFT,
          appliedByStaff: null,
          assignedStaff: null,
        },
        {
          status: VisaApplicationStatus.UNDER_REVIEW,
          appliedByStaff: null,
          assignedStaff: null,
        },
      ]);

      const result = await service.statusBreakdown({});

      expect(result.total).toBe(3);
      expect(result.byStatus[VisaApplicationStatus.DRAFT]).toBe(2);
      expect(result.byStatus[VisaApplicationStatus.UNDER_REVIEW]).toBe(1);
      expect(result.byStatus[VisaApplicationStatus.EXPIRED]).toBe(0);
      expect(result.byStatus[VisaApplicationStatus.COMPLETED]).toBe(0);
      // Every enum value must be present, not just the ones with a count.
      expect(Object.keys(result.byStatus)).toHaveLength(
        Object.keys(VisaApplicationStatus).length,
      );
    });

    it('filters to a single branch by either applying or assigned staff member', async () => {
      prisma.visaApplication.findMany.mockResolvedValue([
        {
          status: VisaApplicationStatus.UNDER_REVIEW,
          appliedByStaff: { branchId: 'branch-1' },
          assignedStaff: null,
        },
        {
          status: VisaApplicationStatus.UNDER_REVIEW,
          appliedByStaff: { branchId: 'branch-2' },
          assignedStaff: null,
        },
      ]);

      const result = await service.statusBreakdown({ branchId: 'branch-1' });

      expect(result.total).toBe(1);
      expect(result.byStatus[VisaApplicationStatus.UNDER_REVIEW]).toBe(1);
    });

    it('passes the customerId and status filters straight through to the query', async () => {
      prisma.visaApplication.findMany.mockResolvedValue([]);

      await service.statusBreakdown({
        customerId: 'cust-1',
        status: VisaApplicationStatus.COMPLETED,
      });

      expect(prisma.visaApplication.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            customerId: 'cust-1',
            status: VisaApplicationStatus.COMPLETED,
          }),
        }),
      );
    });
  });
});
