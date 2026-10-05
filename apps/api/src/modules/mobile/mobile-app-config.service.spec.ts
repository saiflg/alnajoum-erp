import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MobileAppConfigService } from './mobile-app-config.service';

describe('MobileAppConfigService', () => {
  let service: MobileAppConfigService;
  let prisma: {
    mobileAppConfig: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      upsert: jest.Mock;
    };
  };
  let auditService: { record: jest.Mock };

  beforeEach(async () => {
    prisma = {
      mobileAppConfig: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        upsert: jest.fn(),
      },
    };
    auditService = { record: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MobileAppConfigService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get(MobileAppConfigService);
  });

  describe('get', () => {
    it('returns a sensible unforced default when no row exists for the platform yet', async () => {
      prisma.mobileAppConfig.findUnique.mockResolvedValue(null);

      const config = await service.get('ANDROID' as never);

      expect(config).toMatchObject({
        platform: 'ANDROID',
        forceUpdate: false,
        maintenanceMode: false,
      });
    });

    it('returns the stored row when one exists', async () => {
      const row = {
        platform: 'IOS',
        minSupportedVersion: '2.0.0',
        recommendedVersion: '2.1.0',
        forceUpdate: true,
        maintenanceMode: false,
        maintenanceMessage: null,
      };
      prisma.mobileAppConfig.findUnique.mockResolvedValue(row);

      const config = await service.get('IOS' as never);

      expect(config).toBe(row);
    });
  });

  describe('upsert', () => {
    it('creates/updates the per-platform row and audits it', async () => {
      prisma.mobileAppConfig.upsert.mockResolvedValue({ id: 'cfg-1', platform: 'ANDROID' });

      await service.upsert(
        'ANDROID' as never,
        {
          minSupportedVersion: '1.0.0',
          recommendedVersion: '1.2.0',
          forceUpdate: false,
        },
        'identity-1',
      );

      expect(prisma.mobileAppConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { platform: 'ANDROID' },
        }),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'mobile.app_config_updated' }),
      );
    });
  });
});
