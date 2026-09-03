import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import {
  createDocumentMulterOptions,
  documentFilePath,
} from '../../common/documents/document-storage.util';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { ReviewVisaDocumentDto } from './dto/review-visa-document.dto';
import { UploadVisaDocumentQueryDto } from './dto/upload-visa-document-query.dto';
import {
  VISA_DOCUMENTS_NAMESPACE,
  VisaDocumentsService,
} from './visa-documents.service';

@Controller('visa/documents')
export class VisaDocumentsAdminController {
  constructor(
    private readonly visaDocumentsService: VisaDocumentsService,
    private readonly usersService: UsersService,
  ) {}

  /** Staff uploading a provider/embassy document, or one on the customer's behalf. */
  @Post('for-application/:applicationId')
  @RequirePermissions(PERMISSIONS.VISA.EDIT)
  @UseInterceptors(
    FileInterceptor(
      'file',
      createDocumentMulterOptions(VISA_DOCUMENTS_NAMESPACE),
    ),
  )
  uploadForApplication(
    @CurrentUser() user: AuthContext,
    @Param('applicationId') applicationId: string,
    @UploadedFile() file: Express.Multer.File,
    @Query() query: UploadVisaDocumentQueryDto,
  ) {
    return this.visaDocumentsService.uploadForApplication(
      applicationId,
      file,
      query.type,
      query.expiryDate,
      user.sub,
    );
  }

  @Post('for-guarantor/:guarantorId')
  @RequirePermissions(PERMISSIONS.VISA.EDIT)
  @UseInterceptors(
    FileInterceptor(
      'file',
      createDocumentMulterOptions(VISA_DOCUMENTS_NAMESPACE),
    ),
  )
  uploadForGuarantor(
    @CurrentUser() user: AuthContext,
    @Param('guarantorId') guarantorId: string,
    @UploadedFile() file: Express.Multer.File,
    @Query() query: UploadVisaDocumentQueryDto,
  ) {
    return this.visaDocumentsService.uploadForGuarantor(
      guarantorId,
      file,
      query.type,
      user.sub,
    );
  }

  @Get('application/:applicationId')
  @RequirePermissions(PERMISSIONS.VISA.VIEW)
  listForApplication(@Param('applicationId') applicationId: string) {
    return this.visaDocumentsService.listForApplication(applicationId);
  }

  @Get('guarantor/:guarantorId')
  @RequirePermissions(PERMISSIONS.VISA.VIEW)
  listForGuarantor(@Param('guarantorId') guarantorId: string) {
    return this.visaDocumentsService.listForGuarantor(guarantorId);
  }

  @Get(':documentId/file')
  @RequirePermissions(PERMISSIONS.VISA.VIEW)
  async download(
    @Param('documentId') documentId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const document = await this.visaDocumentsService.getDocument(documentId);
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

  @Post(':documentId/review')
  @RequirePermissions(PERMISSIONS.VISA.DOCUMENT_REVIEW)
  async review(
    @CurrentUser() user: AuthContext,
    @Param('documentId') documentId: string,
    @Body() dto: ReviewVisaDocumentDto,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    if (!staffId) {
      throw new ForbiddenException('Only staff can review a document');
    }
    return this.visaDocumentsService.review(
      documentId,
      dto.status,
      dto.reviewNote,
      staffId,
    );
  }

  @Delete(':documentId')
  @RequirePermissions(PERMISSIONS.VISA.EDIT)
  async remove(
    @CurrentUser() user: AuthContext,
    @Param('documentId') documentId: string,
  ) {
    await this.visaDocumentsService.deleteDocument(documentId, user.sub);
    return { deleted: true };
  }
}
