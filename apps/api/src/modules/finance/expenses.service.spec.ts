import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ExpenseStatus } from '@prisma/client';
import { ExpensesService } from './expenses.service';

describe('ExpensesService (Phase 22 segregation of duties and atomic claims)', () => {
  const make = () => {
    const prisma = {
      expense: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const audit = { record: jest.fn() };
    const posting = { postExpensePaid: jest.fn().mockResolvedValue(undefined) };
    const service = new ExpensesService(
      prisma as never,
      audit as never,
      posting as never,
    );
    return { prisma, audit, posting, service };
  };
  const pending = {
    id: 'e1',
    status: ExpenseStatus.PENDING,
    createdByStaffId: 'staff-submitter',
    amount: 5000,
    category: 'office',
    account: null,
  };

  describe('approve', () => {
    it('refuses to let the submitter approve their own expense', async () => {
      const { prisma, service } = make();
      prisma.expense.findUnique.mockResolvedValue(pending);
      await expect(service.approve('e1', 'staff-submitter')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.expense.updateMany).not.toHaveBeenCalled();
    });

    it('claims PENDING -> APPROVED atomically', async () => {
      const { prisma, service } = make();
      prisma.expense.findUnique.mockResolvedValue(pending);
      prisma.expense.findUniqueOrThrow.mockResolvedValue({
        ...pending,
        status: ExpenseStatus.APPROVED,
      });
      await service.approve('e1', 'staff-boss');
      expect(prisma.expense.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'e1', status: ExpenseStatus.PENDING },
        }),
      );
    });

    it('loses cleanly when another reviewer decided it first', async () => {
      const { prisma, service } = make();
      prisma.expense.findUnique.mockResolvedValue(pending);
      prisma.expense.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.approve('e1', 'staff-boss')).rejects.toThrow(
        ConflictException,
      );
    });

    it('refuses an expense that is no longer pending', async () => {
      const { prisma, service } = make();
      prisma.expense.findUnique.mockResolvedValue({
        ...pending,
        status: ExpenseStatus.APPROVED,
      });
      await expect(service.approve('e1', 'staff-boss')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('markPaid', () => {
    const approved = { ...pending, status: ExpenseStatus.APPROVED };

    it('claims APPROVED -> PAID before posting, so a repeat cannot post the ledger twice', async () => {
      const { prisma, posting, service } = make();
      prisma.expense.findUnique.mockResolvedValue(approved);
      prisma.expense.findUniqueOrThrow.mockResolvedValue({
        ...approved,
        status: ExpenseStatus.PAID,
      });
      await service.markPaid('e1');
      expect(prisma.expense.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'e1', status: ExpenseStatus.APPROVED },
        }),
      );
      expect(posting.postExpensePaid).toHaveBeenCalledTimes(1);
    });

    it('does not post when a concurrent call already paid it', async () => {
      const { prisma, posting, service } = make();
      prisma.expense.findUnique.mockResolvedValue(approved);
      prisma.expense.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.markPaid('e1')).rejects.toThrow(ConflictException);
      expect(posting.postExpensePaid).not.toHaveBeenCalled();
    });

    it('puts the expense back to APPROVED when the ledger posting fails', async () => {
      const { prisma, posting, service } = make();
      prisma.expense.findUnique.mockResolvedValue(approved);
      prisma.expense.findUniqueOrThrow.mockResolvedValue({
        ...approved,
        status: ExpenseStatus.PAID,
      });
      posting.postExpensePaid.mockRejectedValue(new Error('ledger down'));
      await expect(service.markPaid('e1')).rejects.toThrow('ledger down');
      expect(prisma.expense.updateMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { id: 'e1', status: ExpenseStatus.PAID },
          data: expect.objectContaining({ status: ExpenseStatus.APPROVED }),
        }),
      );
    });
  });

  describe('listAll', () => {
    it("is bound to the submitting staff's company for a tenant caller", async () => {
      const { prisma, service } = make();
      await service.listAll({}, 'company-1');
      const arg = prisma.expense.findMany.mock.calls[0][0];
      expect(arg.where.createdByStaff).toEqual({ companyId: 'company-1' });
      expect(arg.take).toBe(500);
    });

    it('SUPER_ADMIN sees every company', async () => {
      const { prisma, service } = make();
      await service.listAll({ status: ExpenseStatus.PENDING });
      expect(prisma.expense.findMany.mock.calls[0][0].where).toEqual({
        status: ExpenseStatus.PENDING,
      });
    });
  });
});
