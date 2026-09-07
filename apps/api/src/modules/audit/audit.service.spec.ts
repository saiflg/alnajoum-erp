import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  let service: AuditService;
  let prisma: { auditLog: { findMany: jest.Mock; create: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      auditLog: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(AuditService);
  });

  describe('search', () => {
    it("scopes to the caller's tenant when one is given", async () => {
      await service.search({}, 'company-a');

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ companyId: 'company-a' }),
        }),
      );
    });

    it('applies no tenant filter when none is given (SUPER_ADMIN)', async () => {
      await service.search({});

      const call = prisma.auditLog.findMany.mock.calls[0][0];
      expect(call.where).not.toHaveProperty('companyId');
    });

    it('caps the page size at 200 even when a larger limit is requested', async () => {
      await service.search({ limit: 5000 });

      const call = prisma.auditLog.findMany.mock.calls[0][0];
      expect(call.take).toBe(201);
    });

    it('reports nextCursor only when there are more rows than the page size', async () => {
      prisma.auditLog.findMany.mockResolvedValue([
        { id: 'log-1' },
        { id: 'log-2' },
      ]);

      const result = await service.search({ limit: 1 });

      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBe('log-1');
    });

    it('returns a null nextCursor when everything fit on one page', async () => {
      prisma.auditLog.findMany.mockResolvedValue([{ id: 'log-1' }]);

      const result = await service.search({ limit: 50 });

      expect(result.nextCursor).toBeNull();
    });

    it('filters by a date range when given', async () => {
      const from = new Date('2026-01-01');
      const to = new Date('2026-02-01');

      await service.search({ from, to });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { gte: from, lte: to },
          }),
        }),
      );
    });
  });
});
