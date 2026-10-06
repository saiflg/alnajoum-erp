import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  authUser,
  createPrismaMock,
  expectEveryQueryTenantScoped,
  expectNoQueryMentions,
} from '../../common/testing/tenant-scope.testkit';
import { AnalyticsScopeService } from '../analytics/analytics-scope.service';
import { HajjOpsReportsService } from './hajj-ops-reports.service';

function setup() {
  const mock = createPrismaMock();
  const service = new HajjOpsReportsService(
    mock.prisma as never,
    new AnalyticsScopeService(mock.prisma as never),
  );
  return { ...mock, service };
}

const admin = authUser(['COMPANY_ADMIN'], 'co-A');

describe('HajjOpsReportsService — tenant isolation', () => {
  describe('dashboard', () => {
    it('every query (groups, departures, check-ins, fleet) carries the tenant id', async () => {
      const { service, calls, prisma } = setup();
      prisma.$queryRaw.mockResolvedValue([{ n: BigInt(7) }]);

      const result = await service.dashboard(admin);

      expect(result.checkInsToday).toBe(7);
      expectEveryQueryTenantScoped(calls(), 'co-A');
    });

    it('SUPER_ADMIN keeps the platform-wide view: no tenant filter is added', async () => {
      const { service, calls, ran } = setup();
      await service.dashboard(authUser(['SUPER_ADMIN'], null));
      expectNoQueryMentions(calls(), 'companyId');
      expect(ran('$queryRaw')).toBe(0); // the plain count is enough platform-wide
    });

    it('a caller with no company is refused, not shown everything', async () => {
      const { service, ran } = setup();
      await expect(
        service.dashboard(authUser(['COMPANY_ADMIN'], null)),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(ran('hajjGroup.groupBy')).toBe(0);
    });
  });

  describe.each([
    ['hajj', 'hajjPackage', 'hajjRegistration'] as const,
    ['umrah', 'umrahPackage', 'umrahRegistration'] as const,
  ])('%s package profitability', (kind, pkgModel, regModel) => {
    const run = (
      service: HajjOpsReportsService,
      user: ReturnType<typeof authUser>,
    ) =>
      kind === 'hajj'
        ? service.hajjPackageProfitability(user, 'pkg-1')
        : service.umrahPackageProfitability(user, 'pkg-1');

    const pkg = {
      id: 'pkg-1',
      name: 'P',
      currency: 'NGN',
      internalCost: 10,
      costPrice: 10,
    };

    it('counts only the caller’s own company’s registrations', async () => {
      const { service, prisma, calls } = setup();
      prisma[pkgModel].findUnique.mockResolvedValue(pkg);
      prisma[regModel].findMany.mockResolvedValue([
        { pilgrims: [{}, {}], totalAmount: 500, invoice: null },
      ]);

      const result = await run(service, admin);

      expect(result).toMatchObject({
        pilgrimCount: 2,
        revenueBilled: 500,
        estimatedCost: 20,
      });
      expect(prisma[regModel].findMany.mock.calls[0][0]).toMatchObject({
        where: { packageId: 'pkg-1', customer: { companyId: 'co-A' } },
      });
      // The package row itself is a shared catalog entry (no owner); every other
      // query is tenant-keyed.
      expectEveryQueryTenantScoped(calls(), 'co-A', [`${pkgModel}.findUnique`]);
    });

    it('an unknown package is a 404', async () => {
      const { service, prisma } = setup();
      prisma[pkgModel].findUnique.mockResolvedValue(null);
      await expect(run(service, admin)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('a package whose registrations all belong to ANOTHER company is a 404', async () => {
      const { service, prisma } = setup();
      prisma[pkgModel].findUnique.mockResolvedValue(pkg);
      prisma[regModel].findMany.mockResolvedValue([]); // none of co-A's
      prisma[regModel].count.mockResolvedValue(3); // but company B has some
      await expect(run(service, admin)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('a package nobody has registered for yet is shown as zeros, not hidden', async () => {
      const { service, prisma } = setup();
      prisma[pkgModel].findUnique.mockResolvedValue(pkg);
      prisma[regModel].findMany.mockResolvedValue([]);
      prisma[regModel].count.mockResolvedValue(0);
      expect(await run(service, admin)).toMatchObject({
        pilgrimCount: 0,
        revenueBilled: 0,
      });
    });

    it('SUPER_ADMIN sees every registration: no tenant filter is added', async () => {
      const { service, prisma, calls } = setup();
      prisma[pkgModel].findUnique.mockResolvedValue(pkg);
      await run(service, authUser(['SUPER_ADMIN'], null));
      expectNoQueryMentions(calls(), 'companyId');
    });
  });
});
