import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import * as fs from 'fs';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { createDocumentMulterOptions } from '../../common/documents/document-storage.util';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { resolveTenantFilter } from '../../common/utils/tenant.util';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { UploadSupplierDocumentQueryDto } from './dto/upload-supplier-document-query.dto';
import {
  SUPPLIER_DOCUMENTS_NAMESPACE,
  SupplierDocumentsService,
} from './supplier-documents.service';

@Controller()
export class SupplierDocumentsController {
  constructor(
    private readonly service: SupplierDocumentsService,
    private readonly usersService: UsersService,
  ) {}

  @Get('suppliers/:supplierId/documents')
  @RequirePermissions(PERMISSIONS.SUPPLIER.VIEW)
  list(
    @CurrentUser() user: AuthContext,
    @Param('supplierId') supplierId: string,
  ) {
    return this.service.listForSupplier(supplierId, resolveTenantFilter(user));
  }

  @Post('suppliers/:supplierId/documents')
  @RequirePermissions(PERMISSIONS.SUPPLIER.DOCUMENT_MANAGE)
  @UseInterceptors(
    FileInterceptor(
      'file',
      createDocumentMulterOptions(SUPPLIER_DOCUMENTS_NAMESPACE),
    ),
  )
  async upload(
    @CurrentUser() user: AuthContext,
    @Param('supplierId') supplierId: string,
    @UploadedFile() file: Express.Multer.File,
    @Query() query: UploadSupplierDocumentQueryDto,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    return this.service.upload(
      supplierId,
      file,
      query.label,
      query.expiresAt,
      staffId ?? undefined,
      resolveTenantFilter(user),
    );
  }

  @Get('supplier-documents/:documentId/file')
  @RequirePermissions(PERMISSIONS.SUPPLIER.VIEW)
  async download(
    @CurrentUser() user: AuthContext,
    @Param('documentId') documentId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { filePath, mimeType } = await this.service.getFilePath(
      documentId,
      resolveTenantFilter(user),
    );
    res.set({ 'Content-Type': mimeType });
    return new StreamableFile(fs.createReadStream(filePath));
  }

  @Delete('supplier-documents/:documentId')
  @RequirePermissions(PERMISSIONS.SUPPLIER.DOCUMENT_MANAGE)
  remove(
    @CurrentUser() user: AuthContext,
    @Param('documentId') documentId: string,
  ) {
    return this.service.remove(documentId, resolveTenantFilter(user), user.sub);
  }
}
