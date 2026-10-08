import { randomBytes } from 'crypto';
import {
  openBankAccount,
  sealBankAccount,
} from '../../common/security/bank-account-cipher';
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

  describe('key rotation', () => {
    const saved = { ...process.env };
    afterEach(() => {
      process.env.DATA_ENCRYPTION_KEYS = saved.DATA_ENCRYPTION_KEYS;
      process.env.DATA_ENCRYPTION_KEY_ID = saved.DATA_ENCRYPTION_KEY_ID;
      if (saved.DATA_ENCRYPTION_KEYS === undefined)
        delete process.env.DATA_ENCRYPTION_KEYS;
      if (saved.DATA_ENCRYPTION_KEY_ID === undefined)
        delete process.env.DATA_ENCRYPTION_KEY_ID;
      FieldCipher.resetDefaultForTests();
    });

    it('re-encrypts a number held under an OLD key id once the new key is current', async () => {
      const a = randomBytes(32).toString('base64');
      const b = randomBytes(32).toString('base64');
      process.env.DATA_ENCRYPTION_KEYS = `a:${a}`;
      process.env.DATA_ENCRYPTION_KEY_ID = 'a';
      FieldCipher.resetDefaultForTests();
      const underOldKey = sealBankAccount('s1', '0123456789');
      expect(underOldKey).toContain('enc:v1:a:');

      // The operator adds key "b", makes it current, keeps "a" so old values can still be read, and restarts.
      process.env.DATA_ENCRYPTION_KEYS = `a:${a},b:${b}`;
      process.env.DATA_ENCRYPTION_KEY_ID = 'b';
      FieldCipher.resetDefaultForTests();
      const prisma = {
        staff: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ id: 's1', bankAccountNumber: underOldKey }]),
          update: jest.fn().mockResolvedValue({}),
        },
      };
      await new StaffBankAccountsService(
        prisma as never,
        {} as never,
      ).onModuleInit();

      const written = prisma.staff.update.mock.calls[0][0].data
        .bankAccountNumber as string;
      expect(written).toContain('enc:v1:b:');
      expect(openBankAccount('s1', written)).toBe('0123456789');
    });

    it('leaves a number that is already under the current key alone', async () => {
      const prisma = {
        staff: {
          findMany: jest
            .fn()
            .mockResolvedValue([
              {
                id: 's1',
                bankAccountNumber: sealBankAccount('s1', '0123456789'),
              },
            ]),
          update: jest.fn(),
        },
      };
      await new StaffBankAccountsService(
        prisma as never,
        {} as never,
      ).onModuleInit();
      expect(prisma.staff.update).not.toHaveBeenCalled();
    });
  });
});
