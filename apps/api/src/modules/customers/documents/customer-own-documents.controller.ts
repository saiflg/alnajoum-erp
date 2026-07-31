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
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthContext } from '../../../common/interfaces/auth-context.interface';
import { CustomersService } from '../customers.service';
import { documentFilePath, documentMulterOptions } from './document-storage.util';
import { UploadDocumentQueryDto } from './dto/upload-document-query.dto';
import { CustomerDocumentsService } from './customer-documents.service';

@Controller('customers/me/documents')
export class CustomerOwnDocumentsController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly documentsService: CustomerDocumentsService,
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', documentMulterOptions))
  async upload(
    @CurrentUser() user: AuthContext,
    @UploadedFile() file: Express.Multer.File,
    @Query() query: UploadDocumentQueryDto,
  ) {
    const customerId = await this.customersService.getCustomerIdForIdentity(user.sub);
    return this.documentsService.recordUpload(customerId, file, query.type);
  }

  @Get()
  async list(@CurrentUser() user: AuthContext) {
    const customerId = await this.customersService.getCustomerIdForIdentity(user.sub);
    return this.documentsService.listForCustomer(customerId);
  }

  @Get(':documentId/file')
  async download(
    @CurrentUser() user: AuthContext,
    @Param('documentId') documentId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const customerId = await this.customersService.getCustomerIdForIdentity(user.sub);
    const document = await this.documentsService.getDocument(documentId, customerId);
    res.set({
      'Content-Type': document.mimeType,
      'Content-Disposition': `inline; filename="${document.originalFileName}"`,
    });
    return new StreamableFile(fs.createReadStream(documentFilePath(document.storedFileName)));
  }

  @Delete(':documentId')
  async remove(@CurrentUser() user: AuthContext, @Param('documentId') documentId: string) {
    const customerId = await this.customersService.getCustomerIdForIdentity(user.sub);
    await this.documentsService.deleteDocument(documentId, customerId);
    return { deleted: true };
  }
}
