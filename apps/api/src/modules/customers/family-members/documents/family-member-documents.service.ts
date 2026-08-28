import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DocumentType } from '@prisma/client';
import * as fs from 'fs';
import { documentFilePath } from '../../../../common/documents/document-storage.util';
import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../../audit/audit.service';

export const FAMILY_MEMBER_DOCUMENTS_NAMESPACE = 'family-member-documents';

@Injectable()
export class FamilyMemberDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async recordUpload(
    familyMemberId: string,
    file: Express.Multer.File,
    type: DocumentType,
    actorIdentityId?: string,
  ) {
    const document = await this.prisma.familyMemberDocument.create({
      data: {
        familyMemberId,
        type,
        originalFileName: file.originalname,
        storedFileName: file.filename,
        mimeType: file.mimetype,
        sizeBytes: file.size,
      },
    });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'document.uploaded',
      entityType: 'FamilyMemberDocument',
      entityId: document.id,
      metadata: { familyMemberId, type },
    });
    return document;
  }

  listForMember(familyMemberId: string) {
    return this.prisma.familyMemberDocument.findMany({
      where: { familyMemberId },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  /** Fetches a document, optionally enforcing that it belongs to `ownerMemberId`. */
  async getDocument(documentId: string, ownerMemberId?: string) {
    const document = await this.prisma.familyMemberDocument.findUnique({
      where: { id: documentId },
    });
    if (!document) {
      throw new NotFoundException('Document not found');
    }
    if (ownerMemberId && document.familyMemberId !== ownerMemberId) {
      throw new ForbiddenException(
        'This document does not belong to this family member',
      );
    }
    return document;
  }

  async deleteDocument(
    documentId: string,
    ownerMemberId?: string,
    actorIdentityId?: string,
  ) {
    const document = await this.getDocument(documentId, ownerMemberId);
    await this.prisma.familyMemberDocument.delete({
      where: { id: document.id },
    });
    await fs.promises
      .unlink(
        documentFilePath(
          FAMILY_MEMBER_DOCUMENTS_NAMESPACE,
          document.storedFileName,
        ),
      )
      .catch(() => undefined);
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'document.deleted',
      entityType: 'FamilyMemberDocument',
      entityId: documentId,
      metadata: { familyMemberId: document.familyMemberId, type: document.type },
    });
  }
}
