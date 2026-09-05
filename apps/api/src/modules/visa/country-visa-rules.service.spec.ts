import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CountryVisaRulesService } from './country-visa-rules.service';

describe('CountryVisaRulesService', () => {
  let service: CountryVisaRulesService;
  let prisma: {
    countryVisaRule: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
    };
  };
  let auditService: { record: jest.Mock };

  beforeEach(async () => {
    prisma = {
      countryVisaRule: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
    };
    auditService = { record: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CountryVisaRulesService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get(CountryVisaRulesService);
  });

  describe('create', () => {
    it('creates a default (visaType omitted) rule using the "" sentinel', async () => {
      prisma.countryVisaRule.findUnique.mockResolvedValue(null);
      prisma.countryVisaRule.create.mockResolvedValue({
        id: 'r-1',
        country: 'UAE',
        visaType: '',
      });

      await service.create({ country: 'UAE' });

      expect(prisma.countryVisaRule.findUnique).toHaveBeenCalledWith({
        where: { country_visaType: { country: 'UAE', visaType: '' } },
      });
      expect(prisma.countryVisaRule.create).toHaveBeenCalledWith({
        data: { country: 'UAE', visaType: '' },
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'country_visa_rule.created' }),
      );
    });

    it('rejects a duplicate (country, visaType) pair', async () => {
      prisma.countryVisaRule.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(
        service.create({ country: 'UAE', visaType: 'TOURIST' }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.countryVisaRule.create).not.toHaveBeenCalled();
    });
  });

  describe('get', () => {
    it('throws NotFound for a missing rule', async () => {
      prisma.countryVisaRule.findUnique.mockResolvedValue(null);

      await expect(service.get('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('deactivate', () => {
    it('sets isActive false and records an audit entry', async () => {
      prisma.countryVisaRule.findUnique.mockResolvedValue({ id: 'r-1' });
      prisma.countryVisaRule.update.mockResolvedValue({
        id: 'r-1',
        isActive: false,
      });

      await service.deactivate('r-1', 'identity-1');

      expect(prisma.countryVisaRule.update).toHaveBeenCalledWith({
        where: { id: 'r-1' },
        data: { isActive: false },
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'country_visa_rule.deactivated' }),
      );
    });
  });

  describe('getApplicableRule', () => {
    it('prefers a specific (country, visaType) rule over the default when both are active', async () => {
      prisma.countryVisaRule.findUnique.mockResolvedValueOnce({
        id: 'specific',
        isActive: true,
      });

      const result = await service.getApplicableRule('UAE', 'TOURIST');

      expect(result).toEqual({ id: 'specific', isActive: true });
      // Only the specific lookup should have run — no fallback needed.
      expect(prisma.countryVisaRule.findUnique).toHaveBeenCalledTimes(1);
    });

    it('falls back to the default ("") rule when no specific rule is active', async () => {
      prisma.countryVisaRule.findUnique
        .mockResolvedValueOnce(null) // specific
        .mockResolvedValueOnce({ id: 'default', isActive: true }); // generic

      const result = await service.getApplicableRule('UAE', 'TOURIST');

      expect(result).toEqual({ id: 'default', isActive: true });
      expect(prisma.countryVisaRule.findUnique).toHaveBeenNthCalledWith(2, {
        where: { country_visaType: { country: 'UAE', visaType: '' } },
      });
    });

    it('returns null when neither a specific nor a default rule is configured', async () => {
      prisma.countryVisaRule.findUnique.mockResolvedValue(null);

      const result = await service.getApplicableRule('Narnia', 'TOURIST');

      expect(result).toBeNull();
    });

    it('an inactive default rule counts as "nothing configured"', async () => {
      prisma.countryVisaRule.findUnique.mockResolvedValue({
        id: 'default',
        isActive: false,
      });

      const result = await service.getApplicableRule('UAE', null);

      expect(result).toBeNull();
    });
  });
});
