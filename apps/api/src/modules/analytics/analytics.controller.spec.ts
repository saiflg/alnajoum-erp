import { BadRequestException, ForbiddenException } from '@nestjs/common';
import 'reflect-metadata';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { AnalyticsController } from './analytics.controller';

const user = (permissions: string[]): AuthContext =>
  ({
    sub: 'id-1',
    type: 'STAFF',
    roles: ['COMPANY_ADMIN'],
    permissions,
    companyId: 'co-A',
    sessionId: null,
  }) as unknown as AuthContext;

function setup() {
  const scope = {
    companyId: 'co-A',
    branchId: undefined,
    branchLocked: false,
    description: 'Whole company',
  };
  const scopes = { resolve: jest.fn().mockResolvedValue(scope) };
  const metrics = {
    overview: jest.fn().mockResolvedValue({ metrics: [] }),
    baseCurrency: jest.fn().mockResolvedValue('NGN'),
    trend: jest.fn().mockResolvedValue([{ key: '2026-10-01', value: 5 }]),
    byBranch: jest.fn().mockResolvedValue([]),
  };
  const quality = { run: jest.fn().mockResolvedValue({ status: 'CLEAN' }) };
  return {
    scopes,
    metrics,
    quality,
    ctl: new AnalyticsController(
      scopes as never,
      metrics as never,
      quality as never,
    ),
  };
}

const permsOf = (method: keyof AnalyticsController): string[] => {
  // Reading decorator metadata off the prototype, not calling the method.
  const handler = Object.getOwnPropertyDescriptor(
    AnalyticsController.prototype,
    method,
  )?.value as object;
  return (
    (Reflect.getMetadata('permissions', handler) as string[] | undefined) ?? []
  );
};

describe('AnalyticsController', () => {
  it('guards every route with the right analytics permission', () => {
    const P = PERMISSIONS.ANALYTICS;
    expect(permsOf('overview')).toEqual([P.EXECUTIVE_VIEW]);
    expect(permsOf('trend')).toEqual([P.EXECUTIVE_VIEW]);
    expect(permsOf('branches')).toEqual([P.EXECUTIVE_VIEW]);
    expect(permsOf('definitions')).toEqual([P.DEFINITIONS_VIEW]);
    expect(permsOf('dataQuality')).toEqual([P.DATA_QUALITY_VIEW]);
  });

  it("passes the finance flag from the caller's permissions, never from the query", async () => {
    const { ctl, metrics } = setup();
    await ctl.overview(user([PERMISSIONS.ANALYTICS.EXECUTIVE_VIEW]), {});
    expect(metrics.overview.mock.calls[0][0].canViewFinance).toBe(false);
    await ctl.overview(
      user([
        PERMISSIONS.ANALYTICS.EXECUTIVE_VIEW,
        PERMISSIONS.ANALYTICS.FINANCE_VIEW,
      ]),
      {},
    );
    expect(metrics.overview.mock.calls[1][0].canViewFinance).toBe(true);
  });

  it('defaults to this month and resolves the tenant/branch scope through the scope service', async () => {
    const { ctl, scopes, metrics } = setup();
    await ctl.overview(user([]), { branchId: 'br-1' });
    expect(scopes.resolve).toHaveBeenCalledWith(expect.anything(), 'br-1');
    expect(metrics.overview.mock.calls[0][0].range.preset).toBe('THIS_MONTH');
    expect(metrics.overview.mock.calls[0][0].comparison).toBeNull();
  });

  it('NONE means no comparison; a named comparison is passed through', async () => {
    const { ctl, metrics } = setup();
    await ctl.overview(user([]), { comparison: 'NONE' });
    expect(metrics.overview.mock.calls[0][0].comparison).toBeNull();
    await ctl.overview(user([]), { comparison: 'PREVIOUS_YEAR' });
    expect(metrics.overview.mock.calls[1][0].comparison).toBe('PREVIOUS_YEAR');
  });

  it('turns a bad period into a 400, not a 500', async () => {
    const { ctl } = setup();
    await expect(
      ctl.overview(user([]), {
        preset: 'CUSTOM',
        from: '2026-10-10',
        to: '2026-10-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      ctl.overview(user([]), { preset: 'CUSTOM' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      ctl.overview(user([]), {
        preset: 'CUSTOM',
        from: '2010-01-01',
        to: '2026-01-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses the cash trend to a caller without the finance permission, before touching data', async () => {
    const { ctl, scopes, metrics } = setup();
    await expect(
      ctl.trend(user([PERMISSIONS.ANALYTICS.EXECUTIVE_VIEW]), {
        metric: 'cash_collected',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(scopes.resolve).not.toHaveBeenCalled();
    expect(metrics.trend).not.toHaveBeenCalled();
  });

  it('fills a trend with zero for quiet periods', async () => {
    const { ctl } = setup();
    const out = await ctl.trend(user([PERMISSIONS.ANALYTICS.EXECUTIVE_VIEW]), {
      metric: 'bookings_count',
      preset: 'CUSTOM',
      from: '2026-10-01',
      to: '2026-10-03',
      granularity: 'day',
    });
    expect(out.points).toEqual([
      { key: '2026-10-01', value: 5 },
      { key: '2026-10-02', value: 0 },
      { key: '2026-10-03', value: 0 },
    ]);
    expect(out.meta.freshness).toBe('LIVE');
  });

  it('reports a branch-restricted cash trend as UNAVAILABLE with a reason, not as zeros', async () => {
    const { ctl, metrics } = setup();
    metrics.trend.mockResolvedValue(null);
    const out = await ctl.trend(user([PERMISSIONS.ANALYTICS.FINANCE_VIEW]), {
      metric: 'cash_collected',
      branchId: 'br-1',
    });
    expect(out.status).toBe('UNAVAILABLE');
    expect(out.points).toEqual([]);
    expect(out.unavailableReason).toContain('branch');
  });

  it('rejects a request that would produce an unreadable number of points', async () => {
    const { ctl } = setup();
    await expect(
      ctl.trend(user([PERMISSIONS.ANALYTICS.EXECUTIVE_VIEW]), {
        metric: 'booked_value',
        preset: 'CUSTOM',
        from: '2025-01-01',
        to: '2026-12-31',
        granularity: 'day',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('hides finance metric definitions from a caller without the finance permission', () => {
    const { ctl } = setup();
    const keys = (u: AuthContext) =>
      ctl.definitions(u).metrics.map((m) => m.key);
    expect(keys(user([]))).not.toContain('gross_margin');
    expect(keys(user([PERMISSIONS.ANALYTICS.FINANCE_VIEW]))).toContain(
      'gross_margin',
    );
    expect(ctl.definitions(user([])).unavailable.length).toBeGreaterThan(0);
  });
});
