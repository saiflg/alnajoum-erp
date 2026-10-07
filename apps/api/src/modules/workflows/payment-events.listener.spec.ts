import { PaymentWorkflowEventsListener } from './payment-events.listener';

const event = {
  invoiceId: 'inv1',
  customerId: 'c1',
  amount: 250000,
  currency: 'NGN',
};

describe('PaymentWorkflowEventsListener', () => {
  it("publishes payment.succeeded for the customer's own company, with ids and amounts only", async () => {
    const prisma = {
      customer: {
        findUnique: jest.fn(() => Promise.resolve({ companyId: 'co-A' })),
      },
    };
    const bus = { publishSafe: jest.fn(() => Promise.resolve()) };
    await new PaymentWorkflowEventsListener(
      prisma as never,
      bus as never,
    ).onPaid(event);
    expect(prisma.customer.findUnique).toHaveBeenCalledWith({
      where: { id: 'c1' },
      select: { companyId: true },
    });
    expect(bus.publishSafe).toHaveBeenCalledWith({
      type: 'payment.succeeded',
      source: 'payments',
      companyId: 'co-A',
      entityType: 'Invoice',
      entityId: 'inv1',
      payload: {
        payment: { invoiceId: 'inv1', amount: 250000, currency: 'NGN' },
        customer: { id: 'c1' },
      },
    });
  });
  it('uses no dedupe key — equal instalments on one invoice are separate facts', async () => {
    const prisma = {
      customer: {
        findUnique: jest.fn(() => Promise.resolve({ companyId: 'co-A' })),
      },
    };
    const bus = { publishSafe: jest.fn(() => Promise.resolve()) };
    const l = new PaymentWorkflowEventsListener(prisma as never, bus as never);
    await l.onPaid(event);
    await l.onPaid(event);
    expect(bus.publishSafe).toHaveBeenCalledTimes(2);
    for (const c of bus.publishSafe.mock.calls as unknown as [
      Record<string, unknown>,
    ][])
      expect(c[0].dedupeKey).toBeUndefined();
  });
  it('publishes nothing for an unknown customer (no tenant to attribute it to)', async () => {
    const prisma = {
      customer: { findUnique: jest.fn(() => Promise.resolve(null)) },
    };
    const bus = { publishSafe: jest.fn() };
    await new PaymentWorkflowEventsListener(
      prisma as never,
      bus as never,
    ).onPaid(event);
    expect(bus.publishSafe).not.toHaveBeenCalled();
  });
  it('never throws into the payment flow, even if the lookup fails', async () => {
    const prisma = {
      customer: {
        findUnique: jest.fn(() => Promise.reject(new Error('db down'))),
      },
    };
    const bus = { publishSafe: jest.fn() };
    await expect(
      new PaymentWorkflowEventsListener(prisma as never, bus as never).onPaid(
        event,
      ),
    ).resolves.toBeUndefined();
  });
});
