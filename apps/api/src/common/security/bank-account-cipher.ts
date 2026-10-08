import { FieldCipher } from './field-cipher';

/**
 * Staff payout account numbers are encrypted at rest (Phase 22 S-24). The ciphertext is bound to the staff row,
 * so a value copied onto another person's record does not decrypt there. Rows written before encryption
 * existed hold plaintext; `openBankAccount` reads both, and the startup migration seals the old ones.
 */
const context = (staffId: string) => `staff:${staffId}:bankAccountNumber`;

export function sealBankAccount(
  staffId: string,
  accountNumber: string,
): string {
  return FieldCipher.isEncrypted(accountNumber)
    ? accountNumber
    : FieldCipher.default().encrypt(accountNumber, context(staffId));
}

export function openBankAccount(staffId: string, stored: string): string {
  return FieldCipher.default().decryptIfEncrypted(stored, context(staffId));
}
