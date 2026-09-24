import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SupplierDocumentsService } from './supplier-documents.service';

describe('SupplierDocumentsService', () => {
  let service: SupplierDocumentsService;
  let prisma: {
    supplier: { findUnique: jest.Mock };
    supplierDocument: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      delete: jest.Mock;
    };
  };
  let auditService: { record: jest.Mock };

  const mockFile = {
    filename: 'abc123.pdf',
    mimetype: 'application/pdf',
  } as Express.Multer.File;

  beforeEach(async () => {
    prisma = {
      supplier: { findUnique: jest.fn() },
      supplierDocument: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
    };
    auditService = { record: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupplierDocumentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get(SupplierDocumentsService);
  });

  describe('upload — tenant isolation', () => {
    it('throws NotFound for a cross-tenant supplier before creating a document row', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ companyId: 'company-b' });

      await expect(
        service.upload(
          'sup-1',
          mockFile,
          'Certificate',
          undefined,
          'staff-1',
          'company-a',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.supplierDocument.create).not.toHaveBeenCalled();
    });

    it('stores the multer-generated filename, never a raw path, and audits the upload', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ companyId: 'company-a' });
      prisma.supplierDocument.create.mockResolvedValue({ id: 'doc-1' });

      await service.upload(
        'sup-1',
        mockFile,
        'Certificate',
        '2027-01-01',
        'staff-1',
        'company-a',
      );

      expect(prisma.supplierDocument.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          supplierId: 'sup-1',
          label: 'Certificate',
          fileUrl: 'abc123.pdf',
          mimeType: 'application/pdf',
          uploadedByStaffId: 'staff-1',
        }),
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'supplier_document.uploaded' }),
      );
    });
  });

  describe('remove — tenant isolation', () => {
    it('throws NotFound for a document whose supplier belongs to a different tenant', async () => {
      prisma.supplierDocument.findUnique.mockResolvedValue({
        id: 'doc-1',
        supplierId: 'sup-1',
        fileUrl: 'abc.pdf',
        supplier: { companyId: 'company-b' },
      });

      await expect(
        service.remove('doc-1', 'company-a', 'identity-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.supplierDocument.delete).not.toHaveBeenCalled();
    });
  });
});
