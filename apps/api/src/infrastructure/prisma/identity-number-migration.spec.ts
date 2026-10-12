import { Logger } from '@nestjs/common';
import { IdentityNumberMigration } from './identity-number-migration';

/**
 * The migration reads through the decrypting client and writes back through the encrypting one, so with a fake
 * client the behaviour worth proving is the loop: which rows it asks for, that it re-saves each one once, that it
 * ends, and that a row it cannot save does not stop the rest or loop forever.
 */
describe('IdentityNumberMigration', () => {
  const makePrisma = (pending: Record<string, string[]>) => {
    const queue = JSON.parse(JSON.stringify(pending)) as Record<
      string,
      string[]
    >;
    const delegates: Record<
      string,
      { findUnique: jest.Mock; update: jest.Mock }
    > = {};
    const delegate = (name: string) =>
      (delegates[name] ??= {
        findUnique: jest.fn().mockResolvedValue({
          passportNumber: 'A1234567',
          applicantPassportNumber: 'A1234567',
        }),
        update: jest.fn().mockResolvedValue({}),
      });
    const prisma: Record<string, unknown> = {
      $queryRawUnsafe: jest.fn((sql: string) => {
        const table = /FROM "(\w+)"/.exec(sql)![1];
        const key = /passportNumberIndex" IS NULL/.test(sql)
          ? `${table}:index`
          : table;
        const ids = queue[key] ?? [];
        // rows disappear once re-saved; emulate that with the update mocks below
        return Promise.resolve(ids.map((id) => ({ id })));
      }),
    };
    for (const n of [
      'customer',
      'familyMember',
      'flightGroupPassenger',
      'flightBookingPassenger',
      'hajjRegistrationPilgrim',
      'umrahRegistrationPilgrim',
      'visaApplication',
      'corporateTraveler',
    ]) {
      prisma[n] = delegate(n);
    }
    return { prisma, delegates, queue };
  };

  it('does nothing, cheaply, when every row is already sealed', async () => {
    const { prisma, delegates } = makePrisma({});
    const svc = new IdentityNumberMigration(prisma as never);
    await expect(svc.run()).resolves.toEqual({ sealed: 0, indexed: 0 });
    expect(
      Object.values(delegates).every((d) => d.update.mock.calls.length === 0),
    ).toBe(true);
  });

  it('asks only for rows not sealed under the active key, in every encrypted table', async () => {
    const { prisma } = makePrisma({});
    await new IdentityNumberMigration(prisma as never).run();
    const sqls = (prisma.$queryRawUnsafe as jest.Mock).mock.calls.map(
      (c: [string, string?]) => c[0],
    );
    for (const table of [
      'customers',
      'family_members',
      'flight_booking_passengers',
      'visa_applications',
    ]) {
      expect(sqls.some((s) => s.includes(`FROM "${table}"`))).toBe(true);
    }
    expect(sqls.some((s) => s.includes('NOT LIKE $1'))).toBe(true);
    const firstArgs = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0];
    expect(firstArgs[1]).toMatch(/^enc:v1:.+:%$/);
  });

  it('re-saves each pending row once through the encrypting client, then stops', async () => {
    const { prisma, delegates } = makePrisma({ family_members: ['f1', 'f2'] });
    // the same two ids keep being returned (a fake that never removes them): the loop must still end
    const svc = new IdentityNumberMigration(prisma as never);
    const result = await svc.run();

    expect(result.sealed).toBe(2);
    const calls = delegates.familyMember.update.mock.calls.map(
      (c: [{ where: { id: string }; data: Record<string, string> }]) => c[0],
    );
    expect(calls).toEqual([
      { where: { id: 'f1' }, data: { passportNumber: 'A1234567' } },
      { where: { id: 'f2' }, data: { passportNumber: 'A1234567' } },
    ]);
  });

  it('indexes customers that were sealed before the fingerprint existed', async () => {
    const { prisma, delegates } = makePrisma({ 'customers:index': ['c1'] });
    const result = await new IdentityNumberMigration(prisma as never).run();
    expect(result.indexed).toBe(1);
    expect(delegates.customer.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { passportNumber: 'A1234567' },
    });
  });

  it('skips a value it cannot read and carries on with the others', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { prisma, delegates } = makePrisma({ family_members: ['f1', 'f2'] });
    delegates.familyMember.findUnique
      .mockResolvedValueOnce({ passportNumber: '[unreadable: key gone]' })
      .mockResolvedValueOnce({ passportNumber: 'B7654321' });
    const result = await new IdentityNumberMigration(prisma as never).run();
    expect(result.sealed).toBe(1);
    expect(delegates.familyMember.update).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it('logs and survives a row that fails to save', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { prisma, delegates } = makePrisma({ family_members: ['f1', 'f2'] });
    delegates.familyMember.update
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({});
    const result = await new IdentityNumberMigration(prisma as never).run();
    expect(result.sealed).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('db down'));
    error.mockRestore();
  });

  it('never blocks startup: a failure is logged, not thrown', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { prisma } = makePrisma({});
    (prisma.$queryRawUnsafe as jest.Mock).mockRejectedValue(
      new Error('no connection'),
    );
    await expect(
      new IdentityNumberMigration(prisma as never).onModuleInit(),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('Could not encrypt passport numbers'),
    );
    error.mockRestore();
  });
});
