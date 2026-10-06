import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PricingRulesService } from './pricing-rules.service';

const MARKUP = { kind: 'MARKUP', mode: 'PERCENT', value: 10 };

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    companyId: 'company-a',
    name: 'Markup',
    tier: 'PRODUCT',
    priority: 0,
    isActive: true,
    effectiveFrom: null,
    effectiveTo: null,
    conditions: {},
    action: MARKUP,
    currentVersion: 1,
    ...over,
  };
}

describe('PricingRulesService', () => {
  let service: PricingRulesService;
  let prisma: any;
  let audit: { record: jest.Mock };

  beforeEach(async () => {
    prisma = {
      pricingRule: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      pricingRuleVersion: { findMany: jest.fn(), create: jest.fn() },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    audit = { record: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PricingRulesService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    service = moduleRef.get(PricingRulesService);
  });

  describe('tenant isolation', () => {
    it("get: another tenant's rule is NotFound, not Forbidden (no probing)", async () => {
      prisma.pricingRule.findUnique.mockResolvedValue(
        row({ companyId: 'company-b' }),
      );
      await expect(service.get('r1', 'company-a')).rejects.toThrow(
        NotFoundException,
      );
    });
    it('get: a platform default (companyId null) and an own rule are readable', async () => {
      prisma.pricingRule.findUnique.mockResolvedValue(row({ companyId: null }));
      await expect(service.get('r1', 'company-a')).resolves.toBeTruthy();
      prisma.pricingRule.findUnique.mockResolvedValue(row());
      await expect(service.get('r1', 'company-a')).resolves.toBeTruthy();
    });
    it('get: the super admin (no tenant filter) can read any rule', async () => {
      prisma.pricingRule.findUnique.mockResolvedValue(
        row({ companyId: 'company-b' }),
      );
      await expect(service.get('r1', undefined)).resolves.toBeTruthy();
    });
    it('list: scopes to the tenant plus platform defaults', async () => {
      prisma.pricingRule.findMany.mockResolvedValue([]);
      await service.list('company-a');
      expect(prisma.pricingRule.findMany.mock.calls[0][0].where.OR).toEqual([
        { companyId: 'company-a' },
        { companyId: null },
      ]);
    });
  });

  describe('create', () => {
    it('stores the rule AND an immutable version 1, and audits it', async () => {
      prisma.pricingRule.create.mockResolvedValue(row());
      await service.create(
        {
          name: 'Markup',
          tier: 'PRODUCT',
          conditions: {},
          action: MARKUP,
        } as never,
        'company-a',
        'id-1',
      );
      expect(prisma.pricingRule.create).toHaveBeenCalled();
      expect(
        prisma.pricingRuleVersion.create.mock.calls[0][0].data,
      ).toMatchObject({ ruleId: 'r1', version: 1, changeReason: 'Created' });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'revenue.rule_created',
          companyId: 'company-a',
        }),
      );
    });
    it('rejects a malformed action (negative markup) with a 400 before writing anything', async () => {
      await expect(
        service.create(
          {
            name: 'Bad',
            tier: 'PRODUCT',
            conditions: {},
            action: { kind: 'MARKUP', mode: 'FIXED', value: -5 },
          } as never,
          'company-a',
          'id-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.pricingRule.create).not.toHaveBeenCalled();
    });
    it('rejects an inverted effective window', async () => {
      await expect(
        service.create(
          {
            name: 'x',
            tier: 'PRODUCT',
            conditions: {},
            action: MARKUP,
            effectiveFrom: new Date('2027-01-01'),
            effectiveTo: new Date('2026-01-01'),
          } as never,
          'company-a',
          'id-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update — versioning and concurrency', () => {
    it('appends version N+1 with the reason, never overwriting history, and audits before/after', async () => {
      prisma.pricingRule.findUnique.mockResolvedValue(
        row({ currentVersion: 3 }),
      );
      prisma.pricingRule.updateMany.mockResolvedValue({ count: 1 });
      prisma.pricingRule.findUniqueOrThrow.mockResolvedValue(
        row({ currentVersion: 4 }),
      );
      await service.update(
        'r1',
        { priority: 9, reason: 'Seasonal change' },
        'company-a',
        'id-1',
      );
      expect(prisma.pricingRule.updateMany.mock.calls[0][0].where).toEqual({
        id: 'r1',
        currentVersion: 3,
      });
      expect(
        prisma.pricingRuleVersion.create.mock.calls[0][0].data,
      ).toMatchObject({ version: 4, changeReason: 'Seasonal change' });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'revenue.rule_updated',
          reason: 'Seasonal change',
        }),
      );
    });
    it('a stale expectedVersion is a 409', async () => {
      prisma.pricingRule.findUnique.mockResolvedValue(
        row({ currentVersion: 5 }),
      );
      await expect(
        service.update(
          'r1',
          { reason: 'abc', expectedVersion: 4 },
          'company-a',
          'id-1',
        ),
      ).rejects.toThrow(ConflictException);
      expect(prisma.pricingRule.updateMany).not.toHaveBeenCalled();
    });
    it('losing the optimistic-lock race (0 rows updated) is a 409 and writes no version', async () => {
      prisma.pricingRule.findUnique.mockResolvedValue(row());
      prisma.pricingRule.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.update(
          'r1',
          { priority: 2, reason: 'abc' },
          'company-a',
          'id-1',
        ),
      ).rejects.toThrow(ConflictException);
      expect(prisma.pricingRuleVersion.create).not.toHaveBeenCalled();
    });
    it('a tenant admin cannot edit a platform default, but can read it', async () => {
      prisma.pricingRule.findUnique.mockResolvedValue(row({ companyId: null }));
      await expect(
        service.update('r1', { reason: 'abc' }, 'company-a', 'id-1'),
      ).rejects.toThrow(ForbiddenException);
    });
    it("cannot update another tenant's rule (NotFound)", async () => {
      prisma.pricingRule.findUnique.mockResolvedValue(
        row({ companyId: 'company-b' }),
      );
      await expect(
        service.update('r1', { reason: 'abc' }, 'company-a', 'id-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
