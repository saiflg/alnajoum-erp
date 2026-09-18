import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StaffIdCardService } from './staff-id-card.service';

jest.mock('qrcode');

describe('StaffIdCardService', () => {
  let service: StaffIdCardService;
  let prisma: { staff: { findUnique: jest.Mock } };
  const toBufferMock = QRCode.toBuffer as unknown as jest.Mock;

  const staffRow = {
    id: 'staff-1',
    companyId: 'company-1',
    employeeCode: 'EMP-001',
    firstName: 'Amina',
    lastName: 'Bello',
    jobTitle: 'Travel Consultant',
    department: 'Sales',
    isActive: true,
    company: { name: 'Alnajoum Travel Agency' },
    branch: { name: 'Kaduna Branch' },
  };

  // A real (if trivial) 1x1 PNG — pdfkit parses the image header, so an
  // arbitrary byte string fails with "Unknown image format".
  const onePixelPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );

  beforeEach(async () => {
    prisma = { staff: { findUnique: jest.fn() } };
    toBufferMock.mockResolvedValue(onePixelPng);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StaffIdCardService,
        { provide: PrismaService, useValue: prisma },
        {
          // Mirrors real ConfigService.get(key, defaultValue) — returns the
          // default when the key isn't set, same as production with no
          // PUBLIC_WEB_ORIGIN configured.
          provide: ConfigService,
          useValue: {
            get: jest.fn((_key: string, defaultValue?: string) => defaultValue),
          },
        },
      ],
    }).compile();

    service = module.get(StaffIdCardService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('renderIdCard', () => {
    it('throws NotFound when the staff member does not exist', async () => {
      prisma.staff.findUnique.mockResolvedValue(null);

      await expect(service.renderIdCard('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFound for a staff member belonging to a different tenant', async () => {
      prisma.staff.findUnique.mockResolvedValue(staffRow);

      await expect(
        service.renderIdCard('staff-1', 'some-other-company'),
      ).rejects.toThrow(NotFoundException);
    });

    it('encodes a verification URL built from PUBLIC_WEB_ORIGIN, not raw staff data', async () => {
      prisma.staff.findUnique.mockResolvedValue(staffRow);

      await service.renderIdCard('staff-1', 'company-1');

      expect(toBufferMock).toHaveBeenCalledWith(
        'http://localhost:3000/staff-verify/EMP-001',
        expect.any(Object),
      );
    });

    it('returns a PDF stream and a filename keyed on the employee code', async () => {
      prisma.staff.findUnique.mockResolvedValue(staffRow);

      const result = await service.renderIdCard('staff-1', 'company-1');

      expect(result.filename).toBe('staff-id-EMP-001.pdf');
      expect(typeof result.stream.pipe).toBe('function');
    });
  });

  describe('getVerification', () => {
    it('throws NotFound for an unknown employee code', async () => {
      prisma.staff.findUnique.mockResolvedValue(null);

      await expect(service.getVerification('NOPE')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns only display fields plus the live isActive flag — nothing sensitive', async () => {
      prisma.staff.findUnique.mockResolvedValue(staffRow);

      const result = await service.getVerification('EMP-001');

      expect(result).toEqual({
        employeeCode: 'EMP-001',
        firstName: 'Amina',
        lastName: 'Bello',
        jobTitle: 'Travel Consultant',
        department: 'Sales',
        companyName: 'Alnajoum Travel Agency',
        branchName: 'Kaduna Branch',
        isActive: true,
      });
    });

    it('reflects a deactivated staff member as inactive, not hidden', async () => {
      prisma.staff.findUnique.mockResolvedValue({
        ...staffRow,
        isActive: false,
      });

      const result = await service.getVerification('EMP-001');

      expect(result.isActive).toBe(false);
    });

    it('reports no branch as null rather than throwing', async () => {
      prisma.staff.findUnique.mockResolvedValue({ ...staffRow, branch: null });

      const result = await service.getVerification('EMP-001');

      expect(result.branchName).toBeNull();
    });
  });
});
