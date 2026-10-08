import { NotFoundException } from '@nestjs/common';
import {
  TENANT_SCOPES,
  TenantGuardService,
  TenantKind,
} from './tenant-guard.service';

describe('TenantGuardService', () => {
  const make = (found: unknown) => {
    const findFirst = jest.fn().mockResolvedValue(found);
    const prisma = new Proxy({}, { get: () => ({ findFirst }) });
    return { service: new TenantGuardService(prisma as never), findFirst };
  };

  it('lets SUPER_ADMIN (no tenant) through without touching the database', async () => {
    const { service, findFirst } = make(null);
    await expect(
      service.assert('flightBooking', 'b1', undefined),
    ).resolves.toBeUndefined();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("accepts a record that belongs to the caller's company", async () => {
    const { service, findFirst } = make({ id: 'b1' });
    await expect(
      service.assert('flightBooking', 'b1', 'company-1'),
    ).resolves.toBeUndefined();
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'b1', customer: { companyId: 'company-1' } },
      select: { id: true },
    });
  });

  it("answers another company's record exactly like a missing one: NotFound", async () => {
    const { service } = make(null);
    await expect(
      service.assert('flightBooking', 'b-other', 'company-1'),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.assert('flightBooking', 'b-other', 'company-1'),
    ).rejects.toThrow('Flight Booking not found');
  });

  it('a caller with no company matches nothing, never everything', async () => {
    const { service, findFirst } = make(null);
    await expect(
      service.assert('customer', 'c1', '__no_tenant__'),
    ).rejects.toThrow(NotFoundException);
    expect(findFirst.mock.calls[0][0].where).toEqual({
      id: 'c1',
      companyId: '__no_tenant__',
    });
  });

  it('assertAll checks every named record and skips empty ones', async () => {
    const { service, findFirst } = make({ id: 'x' });
    await service.assertAll(
      [
        ['customer', 'c1'],
        ['invoice', null],
        ['flightBooking', 'f1'],
      ],
      'company-1',
    );
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it('scopeOf is empty for SUPER_ADMIN and the relation filter otherwise', () => {
    const { service } = make(null);
    expect(service.scopeOf('lead', undefined)).toEqual({});
    expect(service.scopeOf('customer', 'company-1')).toEqual({
      companyId: 'company-1',
    });
  });

  it('every kind builds a scope that names the company id it was given', () => {
    for (const kind of Object.keys(TENANT_SCOPES) as TenantKind[]) {
      expect(
        JSON.stringify(TENANT_SCOPES[kind].scope('company-xyz')),
      ).toContain('company-xyz');
    }
  });
});
