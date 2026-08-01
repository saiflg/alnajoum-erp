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
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { documentFilePath } from '../../../common/documents/document-storage.util';
import { PERMISSIONS } from '../../rbac/constants/permissions.constant';
import { CustomerDocumentsService } from './customer-documents.service';

const NAMESPACE = 'customer-documents';

@Controller('customers/:customerId/documents')
export class CustomerAdminDocumentsController {
  constructor(private readonly documentsService: CustomerDocumentsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CUSTOMER.READ)
  list(@Param('customerId') customerId: string) {
    return this.documentsService.listForCustomer(customerId);
  }

  @Get(':documentId/file')
  @RequirePermissions(PERMISSIONS.CUSTOMER.READ)
  async download(
    @Param('customerId') customerId: string,
    @Param('documentId') documentId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const document = await this.documentsService.getDocument(
      documentId,
      customerId,
    );
    res.set({
      'Content-Type': document.mimeType,
      'Content-Disposition': `inline; filename="${document.originalFileName}"`,
    });
    return new StreamableFile(
      fs.createReadStream(documentFilePath(NAMESPACE, document.storedFileName)),
    );
  }

  @Delete(':documentId')
  @RequirePermissions(PERMISSIONS.CUSTOMER.DELETE)
  async remove(
    @Param('customerId') customerId: string,
    @Param('documentId') documentId: string,
  ) {
    await this.documentsService.deleteDocument(documentId, customerId);
    return { deleted: true };
  }
}
