import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import { FamilyMemberDocumentsService } from './family-member-documents.service';

jest.mock('fs', () => ({
  ...jest.requireActual<typeof import('fs')>('fs'),
  promises: {
    ...jest.requireActual<typeof import('fs')>('fs').promises,
    unlink: jest.fn().mockResolvedValue(undefined),
  },
}));

describe('FamilyMemberDocumentsService', () => {
  let service: FamilyMemberDocumentsService;
  let prisma: Record<string, Record<string, jest.Mock>>;

  beforeEach(async () => {
    prisma = {
      familyMemberDocument: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FamilyMemberDocumentsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(FamilyMemberDocumentsService);
  });

  describe('getDocument', () => {
    it('throws NotFound when the document does not exist', async () => {
      prisma.familyMemberDocument.findUnique.mockResolvedValue(null);

      await expect(service.getDocument('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws Forbidden when the document belongs to a different family member', async () => {
      prisma.familyMemberDocument.findUnique.mockResolvedValue({
        id: 'doc-1',
        familyMemberId: 'member-a',
      });

      await expect(service.getDocument('doc-1', 'member-b')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('deleteDocument', () => {
    it('rejects deleting a document owned by a different family member', async () => {
      prisma.familyMemberDocument.findUnique.mockResolvedValue({
        id: 'doc-1',
        familyMemberId: 'member-a',
      });

      await expect(service.deleteDocument('doc-1', 'member-b')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.familyMemberDocument.delete).not.toHaveBeenCalled();
    });
  });
});
