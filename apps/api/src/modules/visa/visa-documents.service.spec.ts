import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DocumentType, VisaDocumentStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { VisaDocumentsService } from './visa-documents.service';

describe('VisaDocumentsService', () => {
  let service: VisaDocumentsService;
  let prisma: {
    visaApplication: { findUnique: jest.Mock };
    guarantor: { findUnique: jest.Mock };
    visaDocument: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };
  let notificationsService: { sendDocumentExpiryNotice: jest.Mock };

  const file = {
    originalname: 'passport.jpg',
    filename: 'uuid-1.jpg',
    mimetype: 'image/jpeg',
    size: 1024,
  } as Express.Multer.File;

  beforeEach(async () => {
    prisma = {
      visaApplication: { findUnique: jest.fn() },
      guarantor: { findUnique: jest.fn() },
      visaDocument: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    notificationsService = { sendDocumentExpiryNotice: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VisaDocumentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { record: jest.fn() } },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get(VisaDocumentsService);
  });

  describe('uploadForApplication', () => {
    it('records the document against the application', async () => {
      prisma.visaApplication.findUnique.mockResolvedValue({
        id: 'app-1',
        customerId: 'customer-1',
      });
      prisma.visaDocument.create.mockResolvedValue({ id: 'doc-1' });

      await service.uploadForApplication(
        'app-1',
        file,
        DocumentType.PASSPORT,
        undefined,
        'identity-1',
        'customer-1',
      );

      expect(prisma.visaDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            applicationId: 'app-1',
            type: DocumentType.PASSPORT,
            storedFileName: 'uuid-1.jpg',
          }),
        }),
      );
    });

    it('rejects uploading to an application owned by a different customer', async () => {
      prisma.visaApplication.findUnique.mockResolvedValue({
        id: 'app-1',
        customerId: 'customer-1',
      });

      await expect(
        service.uploadForApplication(
          'app-1',
          file,
          DocumentType.PASSPORT,
          undefined,
          'identity-1',
          'someone-else',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFound for a missing application', async () => {
      prisma.visaApplication.findUnique.mockResolvedValue(null);

      await expect(
        service.uploadForApplication(
          'missing',
          file,
          DocumentType.PASSPORT,
          undefined,
          'identity-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('review', () => {
    it('marks a document VERIFIED with a review note and reviewer', async () => {
      prisma.visaDocument.findUnique.mockResolvedValue({
        id: 'doc-1',
        status: VisaDocumentStatus.PENDING_REVIEW,
      });
      prisma.visaDocument.update.mockResolvedValue({
        id: 'doc-1',
        status: VisaDocumentStatus.VERIFIED,
      });

      await service.review(
        'doc-1',
        VisaDocumentStatus.VERIFIED,
        'Clear and valid',
        'staff-1',
      );

      expect(prisma.visaDocument.update).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        data: expect.objectContaining({
          status: VisaDocumentStatus.VERIFIED,
          reviewNote: 'Clear and valid',
          reviewedByStaffId: 'staff-1',
        }),
      });
    });
  });

  /**
   * Regression — before this fix, getDocument (and everything built on
   * it: download, review, delete, listForApplication, listForGuarantor)
   * took no tenant argument at all, so any staff member holding a visa
   * permission from ANY company could read/review/delete another
   * tenant's passport documents just by guessing a documentId. Same
   * NotFound-not-Forbidden reasoning as every other tenant-scoped lookup
   * in this codebase.
   */
  describe('tenant isolation', () => {
    const docViaApplication = {
      id: 'doc-1',
      status: VisaDocumentStatus.PENDING_REVIEW,
      storedFileName: 'uuid-1.jpg',
      application: {
        customerId: 'customer-1',
        customer: { companyId: 'company-a' },
      },
      guarantor: null,
    };
    const docViaGuarantor = {
      id: 'doc-2',
      status: VisaDocumentStatus.PENDING_REVIEW,
      storedFileName: 'uuid-2.jpg',
      application: null,
      guarantor: {
        application: { customer: { companyId: 'company-a' } },
      },
    };

    describe('getDocument', () => {
      it('404s a document (via application) belonging to a different company', async () => {
        prisma.visaDocument.findUnique.mockResolvedValue(docViaApplication);

        await expect(
          service.getDocument('doc-1', undefined, 'company-b'),
        ).rejects.toThrow(NotFoundException);
      });

      it('404s a document (via guarantor) belonging to a different company', async () => {
        prisma.visaDocument.findUnique.mockResolvedValue(docViaGuarantor);

        await expect(
          service.getDocument('doc-2', undefined, 'company-b'),
        ).rejects.toThrow(NotFoundException);
      });

      it('returns the document when the caller belongs to the same company', async () => {
        prisma.visaDocument.findUnique.mockResolvedValue(docViaApplication);

        await expect(
          service.getDocument('doc-1', undefined, 'company-a'),
        ).resolves.toEqual(docViaApplication);
      });

      it('applies no tenant filter when none is given (SUPER_ADMIN)', async () => {
        prisma.visaDocument.findUnique.mockResolvedValue(docViaApplication);

        await expect(service.getDocument('doc-1')).resolves.toEqual(
          docViaApplication,
        );
      });
    });

    it('review 404s a cross-tenant document instead of updating it', async () => {
      prisma.visaDocument.findUnique.mockResolvedValue(docViaApplication);

      await expect(
        service.review(
          'doc-1',
          VisaDocumentStatus.VERIFIED,
          undefined,
          'staff-1',
          'company-b',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.visaDocument.update).not.toHaveBeenCalled();
    });

    it('deleteDocument 404s a cross-tenant document instead of deleting it', async () => {
      prisma.visaDocument.findUnique.mockResolvedValue(docViaApplication);

      await expect(
        service.deleteDocument('doc-1', 'identity-1', 'company-b'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.visaDocument.delete).not.toHaveBeenCalled();
    });

    it('listForApplication 404s an application belonging to a different company', async () => {
      prisma.visaApplication.findUnique.mockResolvedValue({
        customer: { companyId: 'company-a' },
      });

      await expect(
        service.listForApplication('app-1', 'company-b'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.visaDocument.findMany).not.toHaveBeenCalled();
    });

    it('listForGuarantor 404s a guarantor belonging to a different company', async () => {
      prisma.guarantor.findUnique.mockResolvedValue({
        application: { customer: { companyId: 'company-a' } },
      });

      await expect(
        service.listForGuarantor('guarantor-1', 'company-b'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.visaDocument.findMany).not.toHaveBeenCalled();
    });
  });

  describe('checkExpiring', () => {
    it('flips an already-expired document to EXPIRED and notifies the customer and assigned staff', async () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      prisma.visaDocument.findMany.mockResolvedValue([
        {
          id: 'doc-1',
          type: DocumentType.PASSPORT,
          expiryDate: pastDate,
          application: {
            applicationReference: 'VISA-2026-000001',
            customer: {
              identity: { id: 'cust-identity', email: 'amina@example.com' },
            },
            assignedStaff: {
              identity: { id: 'staff-identity', email: 'staff@example.com' },
            },
          },
        },
      ]);

      const result = await service.checkExpiring();

      expect(prisma.visaDocument.update).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        data: { status: VisaDocumentStatus.EXPIRED },
      });
      expect(
        notificationsService.sendDocumentExpiryNotice,
      ).toHaveBeenCalledTimes(2);
      expect(
        notificationsService.sendDocumentExpiryNotice,
      ).toHaveBeenCalledWith(
        'amina@example.com',
        'cust-identity',
        expect.objectContaining({ isExpired: true }),
      );
      expect(result).toEqual({ expired: 1, expiringSoon: 0 });
    });

    it('counts a document expiring soon (but not yet expired) separately, and does not flip its status', async () => {
      const soonDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      prisma.visaDocument.findMany.mockResolvedValue([
        {
          id: 'doc-2',
          type: DocumentType.PASSPORT,
          expiryDate: soonDate,
          application: {
            applicationReference: 'VISA-2026-000002',
            customer: {
              identity: { id: 'cust-identity', email: 'amina@example.com' },
            },
            assignedStaff: null,
          },
        },
      ]);

      const result = await service.checkExpiring();

      expect(prisma.visaDocument.update).not.toHaveBeenCalled();
      expect(
        notificationsService.sendDocumentExpiryNotice,
      ).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ expired: 0, expiringSoon: 1 });
    });

    it('is a no-op when nothing is expiring', async () => {
      prisma.visaDocument.findMany.mockResolvedValue([]);

      const result = await service.checkExpiring();

      expect(result).toEqual({ expired: 0, expiringSoon: 0 });
      expect(
        notificationsService.sendDocumentExpiryNotice,
      ).not.toHaveBeenCalled();
    });
  });
});
