import { Logger } from '@nestjs/common';
import { FinanceAlertsService } from './finance-alerts.service';

describe('FinanceAlertsService', () => {
  let prisma: {
    customer: { findUnique: jest.Mock };
    invoice: { findUnique: jest.Mock };
    staff: { findFirst: jest.Mock };
    task: { findFirst: jest.Mock; create: jest.Mock };
  };
  let audit: { record: jest.Mock };
  let service: FinanceAlertsService;

  const surplus = () =>
    service.surplusCredited({
      companyId: null,
      customerId: 'cust-1',
      intentId: 'intent-1',
      reference: 'CHK-1',
      invoiceId: 'inv-1',
      amount: 60_900,
      currency: 'NGN',
      invoiceState: 'settled',
    });

  const mismatch = () =>
    service.amountMismatch({
      customerId: 'cust-1',
      relatedId: 'intent-1',
      reference: 'CHK-1',
      expected: { amount: 60_900, currency: 'NGN' },
      received: { amount: 6_090, currency: 'NGN' },
      source: 'invoice checkout',
    });

  beforeEach(() => {
    prisma = {
      customer: {
        findUnique: jest.fn().mockResolvedValue({ companyId: 'co-A' }),
      },
      invoice: {
        findUnique: jest.fn().mockResolvedValue({ invoiceNumber: 'INV-9' }),
      },
      staff: { findFirst: jest.fn().mockResolvedValue({ id: 'staff-fin' }) },
      task: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'task-1' }),
      },
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new FinanceAlertsService(prisma as never, audit as never);
  });

  it('queues a surplus credit for the Finance officer and records it', async () => {
    await surplus();

    expect(prisma.task.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: 'Review surplus payment CHK-1',
        relatedType: 'PAYMENT',
        relatedId: 'intent-1',
        customerId: 'cust-1',
        assignedStaffId: 'staff-fin',
        isAutoCreated: true,
        priority: 'NORMAL',
        description: expect.stringContaining('INV-9'),
      }),
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'finance.surplus_credit_created',
        companyId: 'co-A',
        entityId: 'intent-1',
      }),
    );
  });

  it('raises a payment-amount mismatch as an URGENT task and a security event', async () => {
    await mismatch();

    expect(prisma.task.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: 'Payment amount mismatch CHK-1',
        priority: 'URGENT',
        description: expect.stringContaining('NOT been credited'),
      }),
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'security.payment_amount_mismatch',
        metadata: expect.objectContaining({
          reference: 'CHK-1',
          received: { amount: 6_090, currency: 'NGN' },
        }),
      }),
    );
  });

  it('does not raise the same open alert twice (reconciliation re-checks pending payments)', async () => {
    prisma.task.findFirst.mockResolvedValue({ id: 'already-open' });

    await mismatch();
    await mismatch();

    expect(prisma.task.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('only counts an OPEN task as already raised', async () => {
    await surplus();
    expect(prisma.task.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        relatedType: 'PAYMENT',
        relatedId: 'intent-1',
        status: { in: ['PENDING', 'IN_PROGRESS', 'OVERDUE'] },
      }),
      select: { id: true },
    });
  });

  it('prefers a Finance officer, then falls back to a company administrator', async () => {
    prisma.staff.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'staff-admin' });

    await surplus();

    const roles = prisma.staff.findFirst.mock.calls.map(
      (
        c: [
          {
            where: {
              identity: { roles: { some: { role: { name: string } } } };
            };
          },
        ],
      ) => c[0].where.identity.roles.some.role.name,
    );
    expect(roles).toEqual(['FINANCE_OFFICER', 'COMPANY_ADMIN']);
    expect(prisma.task.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ assignedStaffId: 'staff-admin' }),
    });
  });

  it('still records the event when nobody can be assigned, and says so in the log', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    prisma.staff.findFirst.mockResolvedValue(null);

    await mismatch();

    expect(prisma.task.create).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('No Finance officer or administrator'),
    );
    error.mockRestore();
  });

  it('never throws: a payment must not be undone or blocked by an alert that could not be raised', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    prisma.task.create.mockRejectedValue(new Error('db down'));

    await expect(surplus()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('Could not raise finance alert'),
    );
    error.mockRestore();
  });

  it('does nothing for a customer whose company cannot be determined', async () => {
    prisma.customer.findUnique.mockResolvedValue(null);

    await mismatch();

    expect(prisma.task.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});
