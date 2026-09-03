import {
  Controller,
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
import {
  createDocumentMulterOptions,
  documentFilePath,
} from '../../common/documents/document-storage.util';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CustomersService } from '../customers/customers.service';
import { UploadVisaDocumentQueryDto } from './dto/upload-visa-document-query.dto';
import {
  VISA_DOCUMENTS_NAMESPACE,
  VisaDocumentsService,
} from './visa-documents.service';

/** Customer self-service document upload/download for one of their own visa applications. */
@Controller('visa/applications/me/:applicationId/documents')
export class VisaDocumentsOwnController {
  constructor(
    private readonly visaDocumentsService: VisaDocumentsService,
    private readonly customersService: CustomersService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @UseInterceptors(
    FileInterceptor(
      'file',
      createDocumentMulterOptions(VISA_DOCUMENTS_NAMESPACE),
    ),
  )
  async upload(
    @CurrentUser() user: AuthContext,
    @Param('applicationId') applicationId: string,
    @UploadedFile() file: Express.Multer.File,
    @Query() query: UploadVisaDocumentQueryDto,
  ) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    return this.visaDocumentsService.uploadForApplication(
      applicationId,
      file,
      query.type,
      query.expiryDate,
      user.sub,
      customerId,
    );
  }

  @Get()
  async list(
    @CurrentUser() user: AuthContext,
    @Param('applicationId') applicationId: string,
  ) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    const application = await this.prisma.visaApplication.findUnique({
      where: { id: applicationId },
      select: { customerId: true },
    });
    if (!application || application.customerId !== customerId) {
      return [];
    }
    return this.visaDocumentsService.listForApplication(applicationId);
  }

  @Get(':documentId/file')
  async download(
    @CurrentUser() user: AuthContext,
    @Param('documentId') documentId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    const document = await this.visaDocumentsService.getDocument(
      documentId,
      customerId,
    );
    res.set({
      'Content-Type': document.mimeType,
      'Content-Disposition': `inline; filename="${document.originalFileName}"`,
    });
    return new StreamableFile(
      fs.createReadStream(
        documentFilePath(VISA_DOCUMENTS_NAMESPACE, document.storedFileName),
      ),
    );
  }
}
