import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CustomerDocumentsService } from './customer-documents.service';

jest.mock('fs', () => ({
  ...jest.requireActual<typeof import('fs')>('fs'),
  promises: {
    ...jest.requireActual<typeof import('fs')>('fs').promises,
    unlink: jest.fn().mockResolvedValue(undefined),
  },
}));

describe('CustomerDocumentsService', () => {
  let service: CustomerDocumentsService;
  let prisma: Record<string, Record<string, jest.Mock>>;

  beforeEach(async () => {
    prisma = {
      customerDocument: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerDocumentsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(CustomerDocumentsService);
  });

  describe('getDocument', () => {
    it('throws NotFound when the document does not exist', async () => {
      prisma.customerDocument.findUnique.mockResolvedValue(null);

      await expect(service.getDocument('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws Forbidden when the document belongs to a different customer', async () => {
      prisma.customerDocument.findUnique.mockResolvedValue({
        id: 'doc-1',
        customerId: 'customer-a',
      });

      await expect(service.getDocument('doc-1', 'customer-b')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('returns the document when it belongs to the given owner', async () => {
      prisma.customerDocument.findUnique.mockResolvedValue({
        id: 'doc-1',
        customerId: 'customer-a',
      });

      await expect(service.getDocument('doc-1', 'customer-a')).resolves.toEqual(
        expect.objectContaining({ id: 'doc-1' }),
      );
    });

    it('returns the document without an ownership check when no owner is given', async () => {
      prisma.customerDocument.findUnique.mockResolvedValue({
        id: 'doc-1',
        customerId: 'customer-a',
      });

      await expect(service.getDocument('doc-1')).resolves.toEqual(
        expect.objectContaining({ id: 'doc-1' }),
      );
    });
  });

  describe('deleteDocument', () => {
    it('rejects deleting a document owned by someone else', async () => {
      prisma.customerDocument.findUnique.mockResolvedValue({
        id: 'doc-1',
        customerId: 'customer-a',
      });

      await expect(
        service.deleteDocument('doc-1', 'customer-b'),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.customerDocument.delete).not.toHaveBeenCalled();
    });
  });
});
