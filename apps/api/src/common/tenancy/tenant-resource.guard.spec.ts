import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantGuardService } from './tenant-guard.service';
import { TenantResourceGuard } from './tenant-resource.guard';
import { TENANT_SCOPED_KEY, TenantScopeSpec } from './tenant-scoped.decorator';

function ctx(opts: {
  specs?: TenantScopeSpec[];
  user?: unknown;
  params?: Record<string, string>;
  body?: Record<string, unknown>;
}) {
  const reflector = {
    getAllAndMerge: jest.fn((key: string) =>
      key === TENANT_SCOPED_KEY ? opts.specs : undefined,
    ),
  } as unknown as Reflector;
  const assert = jest.fn().mockResolvedValue(undefined);
  const guard = new TenantResourceGuard(reflector, {
    assert,
  } as unknown as TenantGuardService);
  const context = {
    getClass: () => class {},
    getHandler: () => () => undefined,
    switchToHttp: () => ({
      getRequest: () => ({
        user: opts.user,
        params: opts.params ?? {},
        body: opts.body ?? {},
        query: {},
      }),
    }),
  } as unknown as ExecutionContext;
  return { guard, context, assert };
}
const tenantUser = { roles: ['COMPANY_ADMIN'], companyId: 'company-1' };

describe('TenantResourceGuard', () => {
  it('does nothing for routes without @TenantScoped', async () => {
    const { guard, context, assert } = ctx({
      user: tenantUser,
      params: { id: 'x' },
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(assert).not.toHaveBeenCalled();
  });

  it("checks the :id param against the caller's company", async () => {
    const { guard, context, assert } = ctx({
      specs: [{ kind: 'flightBooking' }],
      user: tenantUser,
      params: { id: 'b1' },
    });
    await guard.canActivate(context);
    expect(assert).toHaveBeenCalledWith('flightBooking', 'b1', 'company-1');
  });

  it('propagates the NotFound for a record of another company', async () => {
    const { guard, context, assert } = ctx({
      specs: [{ kind: 'flightBooking' }],
      user: tenantUser,
      params: { id: 'b1' },
    });
    assert.mockRejectedValue(new NotFoundException());
    await expect(guard.canActivate(context)).rejects.toThrow(NotFoundException);
  });

  it('lets SUPER_ADMIN through without asking', async () => {
    const { guard, context, assert } = ctx({
      specs: [{ kind: 'customer' }],
      user: { roles: ['SUPER_ADMIN'], companyId: null },
      params: { id: 'c1' },
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(assert).not.toHaveBeenCalled();
  });

  it('a caller with no company is checked against a company that matches nothing', async () => {
    const { guard, context, assert } = ctx({
      specs: [{ kind: 'customer' }],
      user: { roles: ['COMPANY_ADMIN'], companyId: null },
      params: { id: 'c1' },
    });
    await guard.canActivate(context);
    expect(assert).toHaveBeenCalledWith('customer', 'c1', '__no_tenant__');
  });

  it('reads other params and the request body, and skips values that are absent', async () => {
    const { guard, context, assert } = ctx({
      specs: [
        { kind: 'customer', param: 'customerId' },
        { kind: 'customer', param: 'customerId', source: 'body' },
        { kind: 'invoice', param: 'invoiceId', source: 'body' },
      ],
      user: tenantUser,
      params: { customerId: 'c1' },
      body: { customerId: 'c2' },
    });
    await guard.canActivate(context);
    expect(assert.mock.calls).toEqual([
      ['customer', 'c1', 'company-1'],
      ['customer', 'c2', 'company-1'],
    ]);
  });

  it('does not block public routes (no user)', async () => {
    const { guard, context, assert } = ctx({
      specs: [{ kind: 'customer' }],
      params: { id: 'c1' },
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(assert).not.toHaveBeenCalled();
  });
});

describe('@TenantScoped decorator', () => {
  it('accumulates several declarations on one route and merges class + method', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { TenantScoped } = require('./tenant-scoped.decorator');
    @TenantScoped('customer')
    class Ctl {
      @TenantScoped('flightBooking')
      @TenantScoped({ kind: 'staff', param: 'staffId', source: 'body' })
      handler() {
        return 1;
      }
    }
    const method = Reflect.getMetadata(
      TENANT_SCOPED_KEY,
      Ctl.prototype.handler,
    );
    expect(method).toEqual([
      { kind: 'staff', param: 'staffId', source: 'body' },
      { kind: 'flightBooking' },
    ]);
    expect(Reflect.getMetadata(TENANT_SCOPED_KEY, Ctl)).toEqual([
      { kind: 'customer' },
    ]);
  });
});
