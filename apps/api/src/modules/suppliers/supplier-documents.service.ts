import { Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import { documentFilePath } from '../../common/documents/document-storage.util';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export const SUPPLIER_DOCUMENTS_NAMESPACE = 'supplier-documents';

@Injectable()
export class SupplierDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  private async assertSupplierInTenant(
    supplierId: string,
    tenantCompanyId?: string,
  ): Promise<void> {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { companyId: true },
    });
    if (
      !supplier ||
      (tenantCompanyId !== undefined && supplier.companyId !== tenantCompanyId)
    ) {
      throw new NotFoundException('Supplier not found');
    }
  }

  async upload(
    supplierId: string,
    file: Express.Multer.File,
    label: string,
    expiresAt: string | undefined,
    uploadedByStaffId: string | undefined,
    tenantCompanyId: string | undefined,
  ) {
    await this.assertSupplierInTenant(supplierId, tenantCompanyId);

    const document = await this.prisma.supplierDocument.create({
      data: {
        supplierId,
        label,
        fileUrl: file.filename,
        mimeType: file.mimetype,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        uploadedByStaffId,
      },
    });
    await this.auditService.record({
      action: 'supplier_document.uploaded',
      entityType: 'SupplierDocument',
      entityId: document.id,
      metadata: { supplierId, label },
    });
    return document;
  }

  async listForSupplier(supplierId: string, tenantCompanyId?: string) {
    await this.assertSupplierInTenant(supplierId, tenantCompanyId);
    return this.prisma.supplierDocument.findMany({
      where: { supplierId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getFilePath(documentId: string, tenantCompanyId?: string) {
    const document = await this.prisma.supplierDocument.findUnique({
      where: { id: documentId },
      include: { supplier: { select: { companyId: true } } },
    });
    if (
      !document ||
      (tenantCompanyId !== undefined &&
        document.supplier.companyId !== tenantCompanyId)
    ) {
      throw new NotFoundException('Document not found');
    }
    const filePath = documentFilePath(
      SUPPLIER_DOCUMENTS_NAMESPACE,
      document.fileUrl,
    );
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('Document file is missing from storage');
    }
    return { filePath, mimeType: document.mimeType };
  }

  async remove(
    documentId: string,
    tenantCompanyId: string | undefined,
    actorIdentityId: string,
  ) {
    const document = await this.prisma.supplierDocument.findUnique({
      where: { id: documentId },
      include: { supplier: { select: { companyId: true } } },
    });
    if (
      !document ||
      (tenantCompanyId !== undefined &&
        document.supplier.companyId !== tenantCompanyId)
    ) {
      throw new NotFoundException('Document not found');
    }
    await this.prisma.supplierDocument.delete({ where: { id: documentId } });
    const filePath = documentFilePath(
      SUPPLIER_DOCUMENTS_NAMESPACE,
      document.fileUrl,
    );
    fs.promises.unlink(filePath).catch(() => undefined); // best-effort — the DB row is the source of truth
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'supplier_document.deleted',
      entityType: 'SupplierDocument',
      entityId: documentId,
      metadata: { supplierId: document.supplierId, label: document.label },
    });
  }
}
