import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DocumentType, VisaDocumentStatus } from '@prisma/client';
import * as fs from 'fs';
import { documentFilePath } from '../../common/documents/document-storage.util';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

export const VISA_DOCUMENTS_NAMESPACE = 'visa-documents';

/** Documents expiring within this many days are surfaced by checkExpiring(). */
const EXPIRY_WARNING_DAYS = 30;

@Injectable()
export class VisaDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async uploadForApplication(
    applicationId: string,
    file: Express.Multer.File,
    type: DocumentType,
    expiryDate: string | undefined,
    uploadedByIdentityId: string,
    ownerCustomerId?: string,
  ) {
    const application = await this.prisma.visaApplication.findUnique({
      where: { id: applicationId },
    });
    if (!application) {
      throw new NotFoundException('Visa application not found');
    }
    if (ownerCustomerId && application.customerId !== ownerCustomerId) {
      throw new ForbiddenException(
        'This application does not belong to this customer',
      );
    }

    const document = await this.prisma.visaDocument.create({
      data: {
        applicationId,
        type,
        originalFileName: file.originalname,
        storedFileName: file.filename,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        uploadedByIdentityId,
        expiryDate: expiryDate ? new Date(expiryDate) : null,
      },
    });
    await this.auditService.record({
      identityId: uploadedByIdentityId,
      action: 'visa_document.uploaded',
      entityType: 'VisaDocument',
      entityId: document.id,
      metadata: { applicationId, type },
    });
    return document;
  }

  async uploadForGuarantor(
    guarantorId: string,
    file: Express.Multer.File,
    type: DocumentType,
    uploadedByIdentityId: string,
  ) {
    const guarantor = await this.prisma.guarantor.findUnique({
      where: { id: guarantorId },
    });
    if (!guarantor) {
      throw new NotFoundException('Guarantor not found');
    }
    const document = await this.prisma.visaDocument.create({
      data: {
        guarantorId,
        type,
        originalFileName: file.originalname,
        storedFileName: file.filename,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        uploadedByIdentityId,
      },
    });
    await this.auditService.record({
      identityId: uploadedByIdentityId,
      action: 'visa_document.uploaded',
      entityType: 'VisaDocument',
      entityId: document.id,
      metadata: { guarantorId, type },
    });
    return document;
  }

  listForApplication(applicationId: string) {
    return this.prisma.visaDocument.findMany({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  listForGuarantor(guarantorId: string) {
    return this.prisma.visaDocument.findMany({
      where: { guarantorId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getDocument(id: string, ownerCustomerId?: string) {
    const document = await this.prisma.visaDocument.findUnique({
      where: { id },
      include: { application: { select: { customerId: true } } },
    });
    if (!document) {
      throw new NotFoundException('Document not found');
    }
    if (
      ownerCustomerId &&
      document.application?.customerId !== ownerCustomerId
    ) {
      throw new ForbiddenException(
        'This document does not belong to this customer',
      );
    }
    return document;
  }

  async review(
    id: string,
    status: VisaDocumentStatus,
    reviewNote: string | undefined,
    reviewedByStaffId: string,
  ) {
    const document = await this.getDocument(id);
    const updated = await this.prisma.visaDocument.update({
      where: { id },
      data: {
        status,
        reviewNote,
        reviewedByStaffId,
        reviewedAt: new Date(),
      },
    });
    await this.auditService.record({
      action: 'visa_document.reviewed',
      entityType: 'VisaDocument',
      entityId: id,
      metadata: { reviewedByStaffId, status, previousStatus: document.status },
    });
    return updated;
  }

  /**
   * Scans for documents already expired or expiring within
   * EXPIRY_WARNING_DAYS, flips already-expired ones to EXPIRED, and
   * notifies the applicant + the assigned staff member. Called on demand
   * from RemindersController (matches the existing document-missing sweep
   * pattern) rather than its own cron — one daily reminder sweep, not two.
   */
  async checkExpiring(): Promise<{ expired: number; expiringSoon: number }> {
    const now = new Date();
    const warningCutoff = new Date(
      now.getTime() + EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000,
    );

    const candidates = await this.prisma.visaDocument.findMany({
      where: {
        expiryDate: { not: null, lte: warningCutoff },
        status: { not: VisaDocumentStatus.EXPIRED },
      },
      include: {
        application: {
          include: {
            customer: {
              include: { identity: { select: { id: true, email: true } } },
            },
            assignedStaff: {
              include: { identity: { select: { id: true, email: true } } },
            },
          },
        },
      },
    });

    let expired = 0;
    let expiringSoon = 0;

    for (const doc of candidates) {
      const isExpired = doc.expiryDate! <= now;
      if (isExpired) {
        await this.prisma.visaDocument.update({
          where: { id: doc.id },
          data: { status: VisaDocumentStatus.EXPIRED },
        });
        expired++;
      } else {
        expiringSoon++;
      }

      if (doc.application) {
        await this.notificationsService.sendDocumentExpiryNotice(
          doc.application.customer.identity.email,
          doc.application.customer.identity.id,
          {
            applicationReference: doc.application.applicationReference,
            documentType: doc.type,
            expiryDate: doc.expiryDate!.toISOString(),
            isExpired,
          },
        );
        if (doc.application.assignedStaff) {
          await this.notificationsService.sendDocumentExpiryNotice(
            doc.application.assignedStaff.identity.email,
            doc.application.assignedStaff.identity.id,
            {
              applicationReference: doc.application.applicationReference,
              documentType: doc.type,
              expiryDate: doc.expiryDate!.toISOString(),
              isExpired,
            },
          );
        }
      }
    }

    return { expired, expiringSoon };
  }

  async deleteDocument(id: string, actorIdentityId?: string) {
    const document = await this.getDocument(id);
    await this.prisma.visaDocument.delete({ where: { id } });
    await fs.promises
      .unlink(
        documentFilePath(VISA_DOCUMENTS_NAMESPACE, document.storedFileName),
      )
      .catch(() => undefined);
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'visa_document.deleted',
      entityType: 'VisaDocument',
      entityId: id,
    });
  }
}
