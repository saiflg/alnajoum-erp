import {
  Controller,
  Delete,
  Get,
  Param,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import * as fs from 'fs';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { documentFilePath } from '../../../common/documents/document-storage.util';
import type { AuthContext } from '../../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../../rbac/constants/permissions.constant';
import { CustomerDocumentsService } from './customer-documents.service';

import { TenantScoped } from '../../../common/tenancy/tenant-scoped.decorator';
import { contentDisposition } from '../../../common/documents/file-signature';
import { AuditService } from '../../audit/audit.service';
const NAMESPACE = 'customer-documents';

@Controller('customers/:customerId/documents')
export class CustomerAdminDocumentsController {
  constructor(
    private readonly documentsService: CustomerDocumentsService,
    private readonly auditService: AuditService,
  ) {}

  @TenantScoped({ kind: 'customer', param: 'customerId' })
  @Get()
  @RequirePermissions(PERMISSIONS.CUSTOMER.READ)
  list(@Param('customerId') customerId: string) {
    return this.documentsService.listForCustomer(customerId);
  }

  @TenantScoped({ kind: 'customer', param: 'customerId' })
  @Get(':documentId/file')
  @RequirePermissions(PERMISSIONS.CUSTOMER.READ)
  async download(
    @CurrentUser() user: AuthContext,
    @Param('customerId') customerId: string,
    @Param('documentId') documentId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const document = await this.documentsService.getDocument(
      documentId,
      customerId,
    );
    // Passports and visas: every staff access is on the record.
    await this.auditService.record({
      identityId: user.sub,
      action: 'customer_document.downloaded',
      entityType: 'CustomerDocument',
      entityId: documentId,
      companyId: user.companyId ?? undefined,
      metadata: { customerId, type: document.type },
    });
    res.set({
      'Content-Type': document.mimeType,
      'Content-Disposition': contentDisposition(
        'inline',
        document.originalFileName,
      ),
    });
    return new StreamableFile(
      fs.createReadStream(documentFilePath(NAMESPACE, document.storedFileName)),
    );
  }

  @TenantScoped({ kind: 'customer', param: 'customerId' })
  @Delete(':documentId')
  @RequirePermissions(PERMISSIONS.CUSTOMER.DELETE)
  async remove(
    @CurrentUser() user: AuthContext,
    @Param('customerId') customerId: string,
    @Param('documentId') documentId: string,
  ) {
    await this.documentsService.deleteDocument(
      documentId,
      customerId,
      user.sub,
    );
    return { deleted: true };
  }
}
