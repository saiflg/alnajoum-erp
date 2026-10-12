import { StaffCardVerificationService } from './staff-card-verification.service';

const TOKEN = 'abcdefghijklmnopqrstuv'; // 22 characters
const NOW = Date.now();
const day = 86_400_000;

const card = (
  over: Record<string, unknown> = {},
  staff: Record<string, unknown> = {},
) => ({
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
    ...staff,
  },
  ...over,
});

describe('StaffCardVerificationService', () => {
  let prisma: {
    staffIdCard: { findUnique: jest.Mock; findFirst: jest.Mock };
    staff: { findFirst: jest.Mock };
    staffIdCardScan: { create: jest.Mock };
  };
  let service: StaffCardVerificationService;

  beforeEach(() => {
    prisma = {
      staffIdCard: { findUnique: jest.fn(), findFirst: jest.fn() },
      staff: { findFirst: jest.fn() },
      staffIdCardScan: { create: jest.fn().mockResolvedValue({}) },
    };
    service = new StaffCardVerificationService(prisma as never);
  });

  const scanned = () =>
    (
      prisma.staffIdCardScan.create.mock.calls[0] as [
        { data: Record<string, unknown> },
      ]
    )[0].data;
  const ctx = {
    method: 'PUBLIC_LINK' as const,
    ip: '203.0.113.9',
    userAgent: 'jest',
  };

  describe('what a scan shows', () => {
    it('a valid card vouches for the person: name, staff id, department, branch', async () => {
      prisma.staffIdCard.findUnique.mockResolvedValue(card());
      const v = await service.verifyToken(TOKEN, ctx);
      expect(v.result).toBe('VALID');
      expect(v.label).toBe('VALID — ACTIVE CARD');
      expect(v.staff).toMatchObject({
        fullName: 'Amina Yusuf',
        staffId: 'EMP-001',
        department: 'Sales',
        branch: 'Head Office',
        hasPhoto: true,
      });
      expect(v.company?.name).toBe('Alnajoum Travel Agency');
    });

    it.each([
      ['EXPIRED', { expiresAt: new Date(NOW - day) }, 'EXPIRED — CARD EXPIRED'],
      ['SUSPENDED', { status: 'SUSPENDED' }, 'SUSPENDED — CARD SUSPENDED'],
      ['REVOKED', { status: 'REVOKED' }, 'REVOKED — CARD REVOKED'],
      ['REPLACED', { status: 'REPLACED' }, 'REPLACED — OLD CARD REPLACED'],
    ])(
      'a %s card shows the status alone, nothing that identifies a person',
      async (result, over, label) => {
        prisma.staffIdCard.findUnique.mockResolvedValue(card(over));
        const v = await service.verifyToken(TOKEN, ctx);
        expect(v.result).toBe(result);
        expect(v.label).toBe(label);
        expect(v.staff).toBeNull();
        expect(v.card).toBeNull();
        const text = JSON.stringify(v);
        for (const secret of [
          'Amina',
          'Yusuf',
          'EMP-001',
          'ALN-C-AAAA-BBBB',
          'Sales',
          'Head Office',
        ])
          expect(text).not.toContain(secret);
      },
    );

    it('a card that was never activated does not vouch for anyone', async () => {
      prisma.staffIdCard.findUnique.mockResolvedValue(
        card({ status: 'PENDING' }),
      );
      const v = await service.verifyToken(TOKEN, ctx);
      expect(v.result).toBe('INVALID');
      expect(v.staff).toBeNull();
    });

    it('a card of someone who has been deactivated is no longer valid', async () => {
      prisma.staffIdCard.findUnique.mockResolvedValue(
        card({}, { isActive: false }),
      );
      const v = await service.verifyToken(TOKEN, ctx);
      expect(v.result).toBe('REVOKED');
      expect(v.staff).toBeNull();
    });

    it('always asks the database: the answer changes the moment the card does', async () => {
      prisma.staffIdCard.findUnique.mockResolvedValueOnce(card());
      expect((await service.verifyToken(TOKEN, ctx)).result).toBe('VALID');
      prisma.staffIdCard.findUnique.mockResolvedValueOnce(
        card({ status: 'REVOKED' }),
      );
      expect((await service.verifyToken(TOKEN, ctx)).result).toBe('REVOKED');
      expect(prisma.staffIdCard.findUnique).toHaveBeenCalledTimes(2);
    });
  });

  describe('enumeration and scraping', () => {
    it('an unknown code and a malformed one look exactly alike', async () => {
      prisma.staffIdCard.findUnique.mockResolvedValue(null);
      const unknown = await service.verifyToken(TOKEN, ctx);
      const malformed = await service.verifyToken("' OR 1=1 --", ctx);
      const strip = (v: object) => ({ ...v, checkedAt: undefined });
      expect(strip(malformed)).toEqual(strip(unknown));
      expect(unknown.result).toBe('INVALID');
      expect(unknown.company).toBeNull();
    });

    it('a malformed code never reaches the database', async () => {
      for (const bad of [
        '',
        'short',
        'x'.repeat(200),
        '../../etc/passwd',
        'ALN-C-AAAA-BBBB',
      ])
        await service.verifyToken(bad, ctx);
      expect(prisma.staffIdCard.findUnique).not.toHaveBeenCalled();
    });

    it('every attempt is logged, including the failed ones', async () => {
      prisma.staffIdCard.findUnique.mockResolvedValue(null);
      await service.verifyToken('nope', ctx);
      await service.verifyToken(TOKEN, ctx);
      expect(prisma.staffIdCardScan.create).toHaveBeenCalledTimes(2);
      expect(prisma.staffIdCardScan.create.mock.calls[1][0].data).toMatchObject(
        {
          result: 'INVALID',
          method: 'PUBLIC_LINK',
          cardId: null,
        },
      );
    });

    it('the log holds a fingerprint of the client address, never the address, and only the start of what was presented', async () => {
      prisma.staffIdCard.findUnique.mockResolvedValue(card());
      await service.verifyToken(TOKEN, ctx);
      const row = scanned();
      expect(row.ipFingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(row)).not.toContain('203.0.113.9');
      expect(row.queryHint).toBe(TOKEN.slice(0, 6));
      expect(JSON.stringify(row)).not.toContain(TOKEN);
    });

    it('a failure to write the log never turns the answer into an error', async () => {
      prisma.staffIdCard.findUnique.mockResolvedValue(card());
      prisma.staffIdCardScan.create.mockRejectedValue(new Error('db down'));
      await expect(service.verifyToken(TOKEN, ctx)).resolves.toMatchObject({
        result: 'VALID',
      });
    });
  });

  describe('scanned input', () => {
    it.each([
      [TOKEN, TOKEN],
      [`  ${TOKEN}  `, TOKEN],
      [`https://erp.alnajoum.example/verify/card/${TOKEN}`, TOKEN],
      [`http://localhost:3000/verify/card/${TOKEN}?x=1#y`, TOKEN],
      ['https://evil.example/anything', null],
      ['ALN-C-AAAA-BBBB', null],
      ['', null],
      [`https://x/verify/card/${TOKEN}extra`, null],
    ])('%p -> %p', (input, expected) => {
      expect(service.parseScanned(input)).toBe(expected);
    });
  });

  describe('manual lookups (signed-in staff)', () => {
    it('look up a staff id only inside the scanner company', async () => {
      prisma.staff.findFirst.mockResolvedValue(null);
      const v = await service.verifyStaffId(
        'EMP-001',
        {
          method: 'MANUAL_STAFF_ID',
          scannedByIdentityId: 'i1',
          scannerCompanyId: 'co-A',
        },
        'co-A',
      );
      expect(prisma.staff.findFirst).toHaveBeenCalledWith({
        where: { employeeCode: 'EMP-001', companyId: 'co-A' },
        select: { id: true },
      });
      expect(v.result).toBe('INVALID');
      // an unrecognised id still shows up in the scanner's own company history
      expect(scanned().companyId).toBe('co-A');
      expect(scanned().scannedByIdentityId).toBe('i1');
    });

    it('a Super Administrator is not company-limited', async () => {
      prisma.staff.findFirst.mockResolvedValue(null);
      await service.verifyStaffId(
        'EMP-001',
        { method: 'MANUAL_STAFF_ID' },
        undefined,
      );
      expect(prisma.staff.findFirst.mock.calls[0][0].where).toEqual({
        employeeCode: 'EMP-001',
      });
    });

    it('finds a staff member current card', async () => {
      prisma.staff.findFirst.mockResolvedValue({ id: 'staff-1' });
      prisma.staffIdCard.findFirst.mockResolvedValue(card());
      const v = await service.verifyStaffId(
        'EMP-001',
        { method: 'MANUAL_STAFF_ID' },
        'co-A',
      );
      expect(v.result).toBe('VALID');
      expect(prisma.staffIdCard.findFirst.mock.calls[0][0].orderBy).toEqual([
        { createdAt: 'desc' },
      ]);
    });

    it('normalises a hand-typed card reference and keeps it inside the company', async () => {
      prisma.staffIdCard.findFirst.mockResolvedValue(card());
      await service.verifyReference(
        ' aln c aaaa bbbb ',
        { method: 'MANUAL_REFERENCE' },
        'co-A',
      );
      expect(prisma.staffIdCard.findFirst.mock.calls[0][0].where).toEqual({
        cardNumber: 'ALN-C-AAAA-BBBB',
        companyId: 'co-A',
      });
    });

    it("another company's card reads as not recognised, not as forbidden", async () => {
      prisma.staffIdCard.findFirst.mockResolvedValue(null);
      const v = await service.verifyReference(
        'ALN-C-AAAA-BBBB',
        { method: 'MANUAL_REFERENCE' },
        'co-B',
      );
      expect(v.result).toBe('INVALID');
    });
  });

  describe('the photograph', () => {
    it('is only available while the card is valid', async () => {
      for (const over of [
        { status: 'REVOKED' },
        { status: 'SUSPENDED' },
        { expiresAt: new Date(NOW - day) },
      ]) {
        prisma.staffIdCard.findUnique.mockResolvedValueOnce(card(over));
        expect(await service.photoForToken(TOKEN)).toBeNull();
      }
    });

    it('is not looked up for a malformed token', async () => {
      expect(await service.photoForToken('nope')).toBeNull();
      expect(prisma.staffIdCard.findUnique).not.toHaveBeenCalled();
    });

    it('is null for an unknown token', async () => {
      prisma.staffIdCard.findUnique.mockResolvedValue(null);
      expect(await service.photoForToken(TOKEN)).toBeNull();
    });
  });
});
