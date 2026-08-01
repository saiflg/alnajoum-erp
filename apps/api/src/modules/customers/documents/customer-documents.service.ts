import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DocumentType } from '@prisma/client';
import * as fs from 'fs';
import { documentFilePath } from '../../../common/documents/document-storage.util';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

const NAMESPACE = 'customer-documents';

@Injectable()
export class CustomerDocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  async recordUpload(
    customerId: string,
    file: Express.Multer.File,
    type: DocumentType,
  ) {
    return this.prisma.customerDocument.create({
      data: {
        customerId,
        type,
        originalFileName: file.originalname,
        storedFileName: file.filename,
        mimeType: file.mimetype,
        sizeBytes: file.size,
      },
    });
  }

  listForCustomer(customerId: string) {
    return this.prisma.customerDocument.findMany({
      where: { customerId },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  /** Fetches a document, optionally enforcing that it belongs to `ownerCustomerId`. */
  async getDocument(documentId: string, ownerCustomerId?: string) {
    const document = await this.prisma.customerDocument.findUnique({
      where: { id: documentId },
    });
    if (!document) {
      throw new NotFoundException('Document not found');
    }
    if (ownerCustomerId && document.customerId !== ownerCustomerId) {
      throw new ForbiddenException('This document does not belong to you');
    }
    return document;
  }

  async deleteDocument(documentId: string, ownerCustomerId?: string) {
    const document = await this.getDocument(documentId, ownerCustomerId);
    await this.prisma.customerDocument.delete({ where: { id: document.id } });
    await fs.promises
      .unlink(documentFilePath(NAMESPACE, document.storedFileName))
      .catch(() => undefined);
  }
}
