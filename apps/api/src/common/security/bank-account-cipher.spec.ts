import { FieldCipher } from './field-cipher';
import { openBankAccount, sealBankAccount } from './bank-account-cipher';

describe('bank account cipher', () => {
  it('stores the number encrypted and reads it back', () => {
    const sealed = sealBankAccount('staff-1', '0123456789');
    expect(FieldCipher.isEncrypted(sealed)).toBe(true);
    expect(sealed).not.toContain('0123456789');
    expect(openBankAccount('staff-1', sealed)).toBe('0123456789');
  });

  it('is not deterministic (the same number never produces the same stored value)', () => {
    expect(sealBankAccount('staff-1', '0123456789')).not.toBe(
      sealBankAccount('staff-1', '0123456789'),
    );
  });

  it('does not double-encrypt a value that is already sealed', () => {
    const sealed = sealBankAccount('staff-1', '0123456789');
    expect(sealBankAccount('staff-1', sealed)).toBe(sealed);
  });

  it('a value copied onto another staff row does not decrypt there', () => {
    const sealed = sealBankAccount('staff-1', '0123456789');
    expect(() => openBankAccount('staff-2', sealed)).toThrow();
  });

  it('still reads a legacy plaintext value that has not been migrated yet', () => {
    expect(openBankAccount('staff-1', '0123456789')).toBe('0123456789');
  });
});
