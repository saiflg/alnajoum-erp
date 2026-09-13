import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DataImportService } from './data-import.service';

describe('DataImportService', () => {
  let service: DataImportService;
  let prisma: {
    identity: { findUnique: jest.Mock; create: jest.Mock };
  };
  let notificationsService: { sendGeneric: jest.Mock };
  let auditService: { record: jest.Mock };

  beforeEach(async () => {
    prisma = {
      identity: { findUnique: jest.fn(), create: jest.fn() },
    };
    notificationsService = { sendGeneric: jest.fn() };
    auditService = { record: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataImportService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get(DataImportService);
  });

  const csv = (rows: string) => `Email,First Name,Last Name,Phone\n${rows}`;

  it('creates a customer identity scoped to the importing tenant, for a new email', async () => {
    prisma.identity.findUnique.mockResolvedValue(null);
    prisma.identity.create.mockResolvedValue({ id: 'identity-1' });

    const result = await service.importCustomers(
      csv('amina@example.com,Amina,Yusuf,+2348012345678'),
      'company-a',
      'importer-1',
    );

    expect(prisma.identity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'amina@example.com',
          phone: '+2348012345678',
          customer: {
            create: {
              firstName: 'Amina',
              lastName: 'Yusuf',
              companyId: 'company-a',
            },
          },
        }),
      }),
    );
    expect(result).toEqual({
      totalRows: 1,
      created: 1,
      skipped: 0,
      issues: [],
    });
  });

  it('sends the temporary password by email and never returns it', async () => {
    prisma.identity.findUnique.mockResolvedValue(null);
    prisma.identity.create.mockResolvedValue({ id: 'identity-1' });

    await service.importCustomers(
      csv('amina@example.com,Amina,Yusuf,'),
      'company-a',
      'importer-1',
    );

    expect(notificationsService.sendGeneric).toHaveBeenCalledWith(
      'amina@example.com',
      'identity-1',
      expect.any(String),
      expect.stringContaining('Temporary password:'),
    );
  });

  it('skips (does not create) a row whose email already has an account', async () => {
    prisma.identity.findUnique.mockResolvedValue({ id: 'existing' });

    const result = await service.importCustomers(
      csv('amina@example.com,Amina,Yusuf,'),
      'company-a',
      'importer-1',
    );

    expect(prisma.identity.create).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(result.issues).toEqual([
      expect.objectContaining({ row: 2, email: 'amina@example.com' }),
    ]);
  });

  it('reports (without creating anything) a row missing a required column', async () => {
    const result = await service.importCustomers(
      csv(',Amina,Yusuf,'),
      'company-a',
      'importer-1',
    );

    expect(prisma.identity.findUnique).not.toHaveBeenCalled();
    expect(result.issues).toEqual([
      expect.objectContaining({
        row: 2,
        reason: expect.stringContaining('Missing required column'),
      }),
    ]);
  });

  it('keeps processing later rows after one row fails', async () => {
    prisma.identity.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prisma.identity.create
      .mockRejectedValueOnce(new Error('db hiccup'))
      .mockResolvedValueOnce({ id: 'identity-2' });

    const result = await service.importCustomers(
      csv('a@example.com,A,One,\nb@example.com,B,Two,'),
      'company-a',
      'importer-1',
    );

    expect(result.totalRows).toBe(2);
    expect(result.created).toBe(1);
    expect(result.issues).toEqual([
      expect.objectContaining({
        row: 2,
        email: 'a@example.com',
        reason: 'db hiccup',
      }),
    ]);
  });

  it('records one audit entry summarizing the whole import', async () => {
    prisma.identity.findUnique.mockResolvedValue(null);
    prisma.identity.create.mockResolvedValue({ id: 'identity-1' });

    await service.importCustomers(
      csv('amina@example.com,Amina,Yusuf,'),
      'company-a',
      'importer-1',
    );

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        identityId: 'importer-1',
        action: 'data.customers_imported',
        companyId: 'company-a',
        metadata: expect.objectContaining({ totalRows: 1, created: 1 }),
      }),
    );
  });
});
