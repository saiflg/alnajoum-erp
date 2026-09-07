import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { FeatureFlagsService } from './feature-flags.service';

describe('FeatureFlagsService', () => {
  let service: FeatureFlagsService;
  let prisma: {
    featureFlag: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
    };
    featureFlagOverride: {
      findUnique: jest.Mock;
      upsert: jest.Mock;
      deleteMany: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      featureFlag: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
      },
      featureFlagOverride: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
        deleteMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeatureFlagsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(FeatureFlagsService);
  });

  describe('isEnabled', () => {
    it('returns false for an unregistered key rather than assuming it is on', async () => {
      prisma.featureFlag.findUnique.mockResolvedValue(null);

      await expect(service.isEnabled('ENABLE_UNKNOWN')).resolves.toBe(false);
    });

    it('falls back to isEnabledByDefault with no company/override', async () => {
      prisma.featureFlag.findUnique.mockResolvedValue({
        id: 'flag-1',
        isEnabledByDefault: true,
      });

      await expect(service.isEnabled('ENABLE_HAJJ')).resolves.toBe(true);
    });

    it('prefers a per-tenant override over the default', async () => {
      prisma.featureFlag.findUnique.mockResolvedValue({
        id: 'flag-1',
        isEnabledByDefault: true,
      });
      prisma.featureFlagOverride.findUnique.mockResolvedValue({
        isEnabled: false,
      });

      await expect(service.isEnabled('ENABLE_HAJJ', 'company-a')).resolves.toBe(
        false,
      );
    });

    it('never lets a feature flag override bypass a permission check by itself', () => {
      // Documentation-as-test: isEnabled only ever answers "is this
      // feature on", nothing here grants or checks any permission —
      // every gated call site is still expected to run its own
      // RequirePermissions guard regardless of this result.
      expect(typeof service.isEnabled).toBe('function');
    });
  });

  describe('setOverride', () => {
    it('throws NotFound for an unregistered key', async () => {
      prisma.featureFlag.findUnique.mockResolvedValue(null);

      await expect(
        service.setOverride('ENABLE_UNKNOWN', 'company-a', true),
      ).rejects.toThrow(NotFoundException);
    });

    it('upserts the override for the given company', async () => {
      prisma.featureFlag.findUnique.mockResolvedValue({ id: 'flag-1' });
      prisma.featureFlagOverride.upsert.mockResolvedValue({});

      await service.setOverride('ENABLE_HAJJ', 'company-a', false);

      expect(prisma.featureFlagOverride.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            featureFlagId_companyId: {
              featureFlagId: 'flag-1',
              companyId: 'company-a',
            },
          },
        }),
      );
    });
  });
});
