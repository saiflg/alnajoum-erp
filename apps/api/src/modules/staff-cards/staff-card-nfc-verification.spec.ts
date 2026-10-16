import { StaffCardVerificationService } from './staff-card-verification.service';
import { newNfcReference, nfcUrl } from './nfc.ndef';

const TOKEN = 'abcdefghijklmnopqrstuv';
const NOW = Date.now();
const day = 86_400_000;

const card = (over: Record<string, unknown> = {}) => ({
  id: 'card-1',
  companyId: 'co-A',
  cardNumber: 'ALN-C-AAAA-BBBB',
  verificationToken: TOKEN,
  status: 'ACTIVE',
  expiresAt: new Date(NOW + 100 * day),
  staff: {
    employeeCode: 'EMP-001',
    firstName: 'Amina',
    lastName: 'Yusuf',
    jobTitle: 'Agent',
    department: 'Sales',
    isActive: true,
    photoFilename: 'p.jpg',
    branch: { name: 'Head Office' },
    company: {
      name: 'Alnajoum Travel Agency Ltd',
      tradingName: 'Alnajoum Travel Agency',
    },
  },
  ...over,
});

describe('StaffCardVerificationService - NFC (Phase 26B)', () => {
  let prisma: {
    staffIdCard: { findUnique: jest.Mock };
    staffIdCardNfc: { findUnique: jest.Mock; findFirst: jest.Mock };
    staffIdCardScan: { create: jest.Mock };
    nfcReaderDevice: { updateMany: jest.Mock };
  };
  let service: StaffCardVerificationService;
  const ref = newNfcReference();
  const base = {
    method: 'NFC' as const,
    scannedByIdentityId: 'id-1',
    scannerCompanyId: 'co-A',
    tenant: 'co-A' as string | undefined,
    ip: '203.0.113.9',
    userAgent: 'jest',
  };

  beforeEach(() => {
    prisma = {
      staffIdCard: { findUnique: jest.fn() },
      staffIdCardNfc: { findUnique: jest.fn(), findFirst: jest.fn() },
      staffIdCardScan: { create: jest.fn().mockResolvedValue({}) },
      nfcReaderDevice: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    service = new StaffCardVerificationService(prisma as never);
  });
  const chip = (status: string, c = card()) => ({ status, card: c });
  const scan = () =>
    (
      prisma.staffIdCardScan.create.mock.calls[0] as [
        { data: Record<string, unknown> },
      ]
    )[0].data;

  describe('a tap', () => {
    it('is looked up by the chip reference, from the URL or the bare value, and shows who the card belongs to', async () => {
      prisma.staffIdCardNfc.findUnique.mockResolvedValue(chip('VERIFIED'));
      for (const payload of [ref, nfcUrl('https://erp.example.org', ref)]) {
        const v = await service.verifyNfc(payload, base);
        expect(v.result).toBe('VALID');
        expect(v.staff?.fullName).toBe('Amina Yusuf');
        expect(v.method).toBe('NFC');
        expect(v.assurance).toBe('OPAQUE_REFERENCE');
      }
      expect(prisma.staffIdCardNfc.findUnique.mock.calls[0][0].where).toEqual({
        reference: ref,
      });
    });

    it('always tells the reader that a copied chip would carry a copied reference', async () => {
      prisma.staffIdCardNfc.findUnique.mockResolvedValue(chip('VERIFIED'));
      const v = await service.verifyNfc(ref, base);
      expect(v.warnings?.join(' ')).toMatch(/copied/i);
    });

    it.each([
      ['EXPIRED', { expiresAt: new Date(NOW - day) }],
      ['SUSPENDED', { status: 'SUSPENDED' }],
      ['REVOKED', { status: 'REVOKED' }],
      ['REPLACED', { status: 'REPLACED' }],
    ])(
      'a %s card is rejected through NFC exactly as through QR, with nothing identifying shown',
      async (result, over) => {
        prisma.staffIdCardNfc.findUnique.mockResolvedValue(
          chip('VERIFIED', card(over)),
        );
        const v = await service.verifyNfc(ref, base);
        expect(v.result).toBe(result);
        expect(v.staff).toBeNull();
        expect(JSON.stringify(v)).not.toMatch(/Amina|Yusuf|EMP-001|Sales/);
      },
    );

    it('a card whose staff member was deactivated is not valid, whatever the card says', async () => {
      const c = card();
      c.staff.isActive = false;
      prisma.staffIdCardNfc.findUnique.mockResolvedValue(chip('VERIFIED', c));
      expect((await service.verifyNfc(ref, base)).result).toBe('REVOKED');
    });

    it.each(['PREPARED', 'ENCODED', 'FAILED'])(
      'a chip whose writing was never confirmed (%s) is not recognised',
      async (status) => {
        prisma.staffIdCardNfc.findUnique.mockResolvedValue(chip(status));
        const v = await service.verifyNfc(ref, base);
        expect(v.result).toBe('INVALID');
        expect(v.staff).toBeNull();
      },
    );

    it('an unknown reference, a malformed one and a card of another company all look the same', async () => {
      prisma.staffIdCardNfc.findUnique.mockResolvedValueOnce(null);
      const unknown = await service.verifyNfc(ref, base);
      const malformed = await service.verifyNfc('not a reference', base);
      prisma.staffIdCardNfc.findUnique.mockResolvedValueOnce(
        chip('VERIFIED', card({ companyId: 'co-B' })),
      );
      const otherCompany = await service.verifyNfc(ref, base);
      const strip = (v: object) => ({ ...v, checkedAt: 0 });
      expect(strip(malformed)).toEqual(strip(unknown));
      expect(strip(otherCompany)).toEqual(strip(unknown));
      expect(unknown.result).toBe('INVALID');
    });

    it('the QR token of a card is not accepted as its NFC reference', async () => {
      prisma.staffIdCardNfc.findUnique.mockResolvedValue(null);
      expect((await service.verifyNfc(TOKEN, base)).result).toBe('INVALID');
      // The lookup is on the chip table only: the QR token would never be searched as a reference.
      expect(prisma.staffIdCard.findUnique).not.toHaveBeenCalled();
    });

    it('every attempt is recorded with the method, the reader and how strong the check was', async () => {
      prisma.staffIdCardNfc.findUnique.mockResolvedValue(chip('VERIFIED'));
      await service.verifyNfc(ref, { ...base, readerId: 'reader-1' });
      expect(scan()).toMatchObject({
        cardId: 'card-1',
        result: 'VALID',
        method: 'NFC',
        readerId: 'reader-1',
        simulated: false,
        assurance: 'OPAQUE_REFERENCE',
      });
      expect(String(scan().queryHint).length).toBeLessThanOrEqual(6);
      expect(scan().ipFingerprint).not.toContain('203.0.113.9');
    });

    it('updates the reader status with the last tap and its result', async () => {
      prisma.staffIdCardNfc.findUnique.mockResolvedValue(
        chip('VERIFIED', card({ status: 'REVOKED' })),
      );
      await service.verifyNfc(ref, { ...base, readerId: 'reader-1' });
      expect(prisma.nfcReaderDevice.updateMany.mock.calls[0][0]).toMatchObject({
        where: { id: 'reader-1' },
        data: { lastResult: 'REVOKED', lastStatus: 'CONNECTED' },
      });
    });

    it('a scan from the mock reader is marked simulated in the answer and in the record', async () => {
      prisma.staffIdCardNfc.findUnique.mockResolvedValue(chip('VERIFIED'));
      const v = await service.verifyNfc(ref, { ...base, simulated: true });
      expect(v.simulated).toBe(true);
      expect(scan().simulated).toBe(true);
    });

    it('a failure to log never turns the answer into an error', async () => {
      prisma.staffIdCardNfc.findUnique.mockResolvedValue(chip('VERIFIED'));
      prisma.staffIdCardScan.create.mockRejectedValue(new Error('db'));
      expect((await service.verifyNfc(ref, base)).result).toBe('VALID');
    });
  });

  describe('serial number only', () => {
    it('is labelled weak, searched by a keyed hash and never by the number itself', async () => {
      prisma.staffIdCardNfc.findFirst.mockResolvedValue({ card: card() });
      const v = await service.verifyUid('04:A2:2B:1C:5D:6E:80', {
        ...base,
        method: 'NFC_UID',
      });
      expect(v.assurance).toBe('UID_ONLY');
      expect(v.warnings?.join(' ')).toMatch(/copied/i);
      const where = prisma.staffIdCardNfc.findFirst.mock.calls[0][0].where;
      expect(where.companyId).toBe('co-A');
      expect(where.status).toBe('VERIFIED');
      expect(JSON.stringify(where)).not.toContain('04A22B1C5D6E80');
      expect(String(where.uidHash)).toMatch(/^[0-9a-f]{64}$/);
    });
    it('needs a valid serial and a known company, otherwise it is simply not recognised', async () => {
      expect(
        (await service.verifyUid('zz', { ...base, method: 'NFC_UID' })).result,
      ).toBe('INVALID');
      expect(
        (
          await service.verifyUid('04A22B1C', {
            ...base,
            method: 'NFC_UID',
            tenant: undefined,
          })
        ).result,
      ).toBe('INVALID');
      expect(prisma.staffIdCardNfc.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('QR and NFC together', () => {
    it('are accepted only when both lead to the same card', async () => {
      prisma.staffIdCard.findUnique.mockResolvedValue(card());
      prisma.staffIdCardNfc.findUnique.mockResolvedValue(chip('VERIFIED'));
      const v = await service.verifyCombined(
        `https://erp.example.org/verify/card/${TOKEN}`,
        ref,
        { ...base, method: 'QR_AND_NFC' },
      );
      expect(v.result).toBe('VALID');
      expect(v.assurance).toBe('QR_AND_NFC');
      expect(v.method).toBe('QR_AND_NFC');
    });
    it('are refused when they belong to different cards', async () => {
      prisma.staffIdCard.findUnique.mockResolvedValue(card({ id: 'card-1' }));
      prisma.staffIdCardNfc.findUnique.mockResolvedValue(
        chip('VERIFIED', card({ id: 'card-2' })),
      );
      const v = await service.verifyCombined(TOKEN, ref, {
        ...base,
        method: 'QR_AND_NFC',
      });
      expect(v.result).toBe('INVALID');
      expect(v.staff).toBeNull();
      expect(v.warnings?.join(' ')).toMatch(/different cards/);
    });
    it('are refused when either is unknown, and a revoked card is still rejected through both', async () => {
      prisma.staffIdCard.findUnique.mockResolvedValue(null);
      prisma.staffIdCardNfc.findUnique.mockResolvedValue(chip('VERIFIED'));
      expect(
        (
          await service.verifyCombined(TOKEN, ref, {
            ...base,
            method: 'QR_AND_NFC',
          })
        ).result,
      ).toBe('INVALID');
      prisma.staffIdCard.findUnique.mockResolvedValue(
        card({ status: 'REVOKED' }),
      );
      prisma.staffIdCardNfc.findUnique.mockResolvedValue(
        chip('VERIFIED', card({ status: 'REVOKED' })),
      );
      expect(
        (
          await service.verifyCombined(TOKEN, ref, {
            ...base,
            method: 'QR_AND_NFC',
          })
        ).result,
      ).toBe('REVOKED');
    });
  });
});
