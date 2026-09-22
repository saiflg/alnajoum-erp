import { HttpException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { AiUsageService } from './ai-usage.service';

describe('AiUsageService', () => {
  let service: AiUsageService;
  let prisma: {
    aiUsageLog: { count: jest.Mock; create: jest.Mock; findMany: jest.Mock };
  };
  let integrationsService: {
    getActiveProvider: jest.Mock;
    getCredentialConfig: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      aiUsageLog: { count: jest.fn(), create: jest.fn(), findMany: jest.fn() },
    };
    integrationsService = {
      getActiveProvider: jest.fn().mockResolvedValue(null),
      getCredentialConfig: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiUsageService,
        { provide: PrismaService, useValue: prisma },
        { provide: IntegrationsService, useValue: integrationsService },
      ],
    }).compile();

    service = module.get(AiUsageService);
  });

  describe('enforceDailyLimit', () => {
    it('is a no-op when no companyId is given', async () => {
      await service.enforceDailyLimit(undefined);
      expect(prisma.aiUsageLog.count).not.toHaveBeenCalled();
    });

    it('allows the request when usage is under the default limit', async () => {
      prisma.aiUsageLog.count.mockResolvedValue(5);
      await expect(
        service.enforceDailyLimit('company-1'),
      ).resolves.toBeUndefined();
    });

    it('throws 429 once the default limit (200) is reached', async () => {
      prisma.aiUsageLog.count.mockResolvedValue(200);
      await expect(service.enforceDailyLimit('company-1')).rejects.toThrow(
        HttpException,
      );
    });

    it('honors a configured per-company daily limit instead of the default', async () => {
      integrationsService.getActiveProvider.mockResolvedValue('mock');
      integrationsService.getCredentialConfig.mockResolvedValue({
        dailyRequestLimit: '5',
      });
      prisma.aiUsageLog.count.mockResolvedValue(5);

      await expect(service.enforceDailyLimit('company-1')).rejects.toThrow(
        HttpException,
      );
    });

    it('scopes the count to today only', async () => {
      prisma.aiUsageLog.count.mockResolvedValue(0);

      await service.enforceDailyLimit('company-1');

      const call = prisma.aiUsageLog.count.mock.calls[0][0];
      expect(call.where.companyId).toBe('company-1');
      expect(call.where.createdAt.gte).toBeInstanceOf(Date);
    });
  });

  describe('listRecent', () => {
    it('scopes by companyId when a tenant filter is given', async () => {
      prisma.aiUsageLog.findMany.mockResolvedValue([]);

      await service.listRecent('company-a');

      expect(prisma.aiUsageLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId: 'company-a' } }),
      );
    });

    it('applies no filter when none is given (SUPER_ADMIN)', async () => {
      prisma.aiUsageLog.findMany.mockResolvedValue([]);

      await service.listRecent(undefined);

      expect(prisma.aiUsageLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: undefined }),
      );
    });
  });
});
