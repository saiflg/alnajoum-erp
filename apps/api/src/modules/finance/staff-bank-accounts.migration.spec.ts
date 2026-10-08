import { sealBankAccount } from '../../common/security/bank-account-cipher';
import { FieldCipher } from '../../common/security/field-cipher';
import { StaffBankAccountsService } from './staff-bank-accounts.service';

describe('StaffBankAccountsService startup migration (S-24)', () => {
  it('encrypts plaintext account numbers and nothing else', async () => {
    const prisma = {
      staff: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 's1', bankAccountNumber: '0123456789' }]),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const service = new StaffBankAccountsService(prisma as never, {} as never);

    await service.onModuleInit();

    expect(prisma.staff.findMany.mock.calls[0][0].where).toMatchObject({
      NOT: { bankAccountNumber: { startsWith: 'enc:v1:' } },
    });
    const written = prisma.staff.update.mock.calls[0][0].data
      .bankAccountNumber as string;
    expect(FieldCipher.isEncrypted(written)).toBe(true);
    expect(written).not.toContain('0123456789');
  });

  it('never stops the app from starting', async () => {
    const prisma = {
      staff: { findMany: jest.fn().mockRejectedValue(new Error('db down')) },
    };
    const service = new StaffBankAccountsService(prisma as never, {} as never);
    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });

  it('the verifier list shows the real number, decrypted', async () => {
    const prisma = {
      staff: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 's1',
            firstName: 'A',
            lastName: 'B',
            employeeCode: 'E1',
            bankName: 'Bank',
            bankAccountName: 'A B',
            bankAccountNumber: sealBankAccount('s1', '0123456789'),
          },
        ]),
      },
    };
    const service = new StaffBankAccountsService(prisma as never, {} as never);
    const [row] = await service.listUnverified();
    expect(row.bankAccountNumber).toBe('0123456789');
  });
});
