import { randomBytes } from 'crypto';
import { FieldCipher } from '../../common/security/field-cipher';
import {
  openResult,
  passportSearchIndex,
  sealWriteArgs,
} from './identity-number-encryption';

const keyLine = (id: string) => `${id}:${randomBytes(32).toString('base64')}`;
const cipherFor = (keys: string, active?: string) =>
  FieldCipher.fromEnv({
    DATA_ENCRYPTION_KEYS: keys,
    ...(active ? { DATA_ENCRYPTION_KEY_ID: active } : {}),
  });

describe('passport number encryption', () => {
  const k1 = keyLine('k1');
  const cipher = cipherFor(k1);

  describe('sealWriteArgs', () => {
    it('encrypts a passport number on create, never storing the plaintext', () => {
      const out = sealWriteArgs(
        'FamilyMember',
        'create',
        { data: { firstName: 'Amina', passportNumber: 'A1234567' } },
        cipher,
      ) as { data: { firstName: string; passportNumber: string } };
      expect(out.data.firstName).toBe('Amina');
      expect(out.data.passportNumber).toMatch(/^enc:v1:k1:/);
      expect(JSON.stringify(out)).not.toContain('A1234567');
    });

    it('reaches passengers and pilgrims nested inside a booking or registration', () => {
      const out = sealWriteArgs(
        'FlightBooking',
        'create',
        {
          data: {
            pnr: 'ABC123',
            passengers: {
              create: [
                { firstName: 'A', passportNumber: 'P111111' },
                { firstName: 'B', passportNumber: 'P222222' },
                { firstName: 'C' },
              ],
            },
          },
        },
        cipher,
      );
      const json = JSON.stringify(out);
      expect(json).not.toContain('P111111');
      expect(json).not.toContain('P222222');
      expect(json.match(/enc:v1:k1:/g)).toHaveLength(2);
    });

    it('seals the visa applicant field and the { set } form of an update', () => {
      const visa = sealWriteArgs(
        'VisaApplication',
        'update',
        { where: { id: 'v1' }, data: { applicantPassportNumber: 'V9999999' } },
        cipher,
      ) as { data: { applicantPassportNumber: string } };
      expect(visa.data.applicantPassportNumber).toMatch(/^enc:v1:/);

      const set = sealWriteArgs(
        'FamilyMember',
        'update',
        { where: { id: 'f1' }, data: { passportNumber: { set: 'S7654321' } } },
        cipher,
      ) as { data: { passportNumber: { set: string } } };
      expect(set.data.passportNumber.set).toMatch(/^enc:v1:/);
    });

    it('seals both sides of an upsert', () => {
      const out = sealWriteArgs(
        'CorporateTraveler',
        'upsert',
        {
          where: { id: 't1' },
          create: { passportNumber: 'C1111111' },
          update: { passportNumber: 'C2222222' },
        },
        cipher,
      );
      expect(JSON.stringify(out)).not.toMatch(/C1111111|C2222222/);
    });

    it('leaves a where clause and a select alone (only stored values are sealed)', () => {
      const args = {
        where: { passportNumber: 'A1234567' },
        select: { passportNumber: true },
      };
      expect(sealWriteArgs('Customer', 'findMany', args, cipher)).toBe(args);
      const upd = sealWriteArgs(
        'FamilyMember',
        'updateMany',
        { where: { passportNumber: 'OLD' }, data: { firstName: 'X' } },
        cipher,
      ) as { where: { passportNumber: string } };
      expect(upd.where.passportNumber).toBe('OLD');
    });

    it('does not seal a value twice', () => {
      const once = cipher.encrypt('A1234567', 'identity-number');
      const out = sealWriteArgs(
        'FamilyMember',
        'create',
        { data: { passportNumber: once } },
        cipher,
      ) as { data: { passportNumber: string } };
      expect(out.data.passportNumber).toBe(once);
    });

    it('leaves null and undefined alone', () => {
      const out = sealWriteArgs(
        'FamilyMember',
        'update',
        { where: { id: 'f' }, data: { passportNumber: null } },
        cipher,
      ) as { data: { passportNumber: null } };
      expect(out.data.passportNumber).toBeNull();
    });
  });

  describe('the customer lookup fingerprint', () => {
    it('is written alongside the encrypted number, from the plaintext', () => {
      const out = sealWriteArgs(
        'Customer',
        'update',
        { where: { id: 'c1' }, data: { passportNumber: 'A 1234-567' } },
        cipher,
      ) as { data: { passportNumber: string; passportNumberIndex: string } };
      expect(out.data.passportNumber).toMatch(/^enc:v1:/);
      expect(out.data.passportNumberIndex).toBe(
        passportSearchIndex('a1234567', cipher),
      );
    });

    it('is cleared when the passport number is cleared, and untouched when it is not written', () => {
      const cleared = sealWriteArgs(
        'Customer',
        'update',
        { where: { id: 'c1' }, data: { passportNumber: null } },
        cipher,
      ) as { data: { passportNumberIndex: string | null } };
      expect(cleared.data.passportNumberIndex).toBeNull();

      const other = sealWriteArgs(
        'Customer',
        'update',
        { where: { id: 'c1' }, data: { firstName: 'Z' } },
        cipher,
      ) as { data: Record<string, unknown> };
      expect('passportNumberIndex' in other.data).toBe(false);

      const undef = sealWriteArgs(
        'Customer',
        'update',
        { where: { id: 'c1' }, data: { passportNumber: undefined } },
        cipher,
      ) as { data: Record<string, unknown> };
      expect('passportNumberIndex' in undef.data).toBe(false);
    });

    it('is only kept on customers', () => {
      const out = sealWriteArgs(
        'FamilyMember',
        'create',
        { data: { passportNumber: 'A1234567' } },
        cipher,
      ) as { data: Record<string, unknown> };
      expect('passportNumberIndex' in out.data).toBe(false);
    });

    it('matches regardless of spacing, dashes and case, but not a different number', () => {
      const a = passportSearchIndex('ab 123-456', cipher);
      expect(passportSearchIndex('AB123456', cipher)).toBe(a);
      expect(passportSearchIndex('AB123457', cipher)).not.toBe(a);
    });

    it('is keyed: another deployment key gives a different fingerprint', () => {
      const other = cipherFor(keyLine('x1'));
      expect(passportSearchIndex('AB123456', other)).not.toBe(
        passportSearchIndex('AB123456', cipher),
      );
    });

    it('survives rotating the active key (it follows the first listed key)', () => {
      const second = keyLine('k2');
      const rotated = cipherFor(`${k1},${second}`, 'k2');
      expect(passportSearchIndex('AB123456', rotated)).toBe(
        passportSearchIndex('AB123456', cipherFor(k1)),
      );
    });
  });

  describe('openResult', () => {
    it('decrypts at any depth, passes legacy plaintext through, and never returns the fingerprint', () => {
      const sealed = cipher.encrypt('A1234567', 'identity-number');
      const out = openResult(
        [
          {
            id: 1,
            passportNumber: sealed,
            passportNumberIndex: 'abc',
            passengers: [
              { passportNumber: sealed },
              { passportNumber: 'OLD1' },
            ],
            when: new Date('2026-01-01'),
          },
        ],
        cipher,
      ) as {
        passportNumber: string;
        passengers: { passportNumber: string }[];
        when: Date;
      }[];
      expect(out[0].passportNumber).toBe('A1234567');
      expect(out[0].passengers.map((p) => p.passportNumber)).toEqual([
        'A1234567',
        'OLD1',
      ]);
      expect('passportNumberIndex' in out[0]).toBe(false);
      expect(out[0].when).toBeInstanceOf(Date);
    });

    it('opens a value sealed under a previous key', () => {
      const old = cipherFor(k1).encrypt('Z9999999', 'identity-number');
      const rotated = cipherFor(`${k1},${keyLine('k2')}`, 'k2');
      expect(
        (
          openResult({ passportNumber: old }, rotated) as {
            passportNumber: string;
          }
        ).passportNumber,
      ).toBe('Z9999999');
    });

    it('shows a safe placeholder, not an error, when the key is missing', () => {
      const sealed = cipherFor(keyLine('gone')).encrypt(
        'Q1',
        'identity-number',
      );
      const out = openResult({ id: 1, passportNumber: sealed }, cipher) as {
        id: number;
        passportNumber: string;
      };
      expect(out.id).toBe(1);
      expect(out.passportNumber).toMatch(/^\[unreadable/);
    });

    it('does not decrypt a value copied from a different kind of field', () => {
      const wrongContext = cipher.encrypt('A1234567', 'something-else');
      const out = openResult({ passportNumber: wrongContext }, cipher) as {
        passportNumber: string;
      };
      expect(out.passportNumber).toMatch(/^\[unreadable/);
    });
  });
});
