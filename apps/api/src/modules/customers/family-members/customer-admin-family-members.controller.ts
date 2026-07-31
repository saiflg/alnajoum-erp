import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import {
  createDocumentMulterOptions,
  documentFilePath,
} from '../../../common/documents/document-storage.util';
import { assertImageIsReadableOrCleanup } from '../../../common/documents/image-quality.util';
import { PERMISSIONS } from '../../rbac/constants/permissions.constant';
import { UploadDocumentQueryDto } from '../documents/dto/upload-document-query.dto';
import {
  FAMILY_MEMBER_DOCUMENTS_NAMESPACE,
  FamilyMemberDocumentsService,
} from './documents/family-member-documents.service';
import { CreateFamilyMemberDto } from './dto/create-family-member.dto';
import { UpdateFamilyMemberDto } from './dto/update-family-member.dto';
import { FamilyMembersService } from './family-members.service';

@Controller('customers/:customerId/family-members')
export class CustomerAdminFamilyMembersController {
  constructor(
    private readonly familyMembersService: FamilyMembersService,
    private readonly documentsService: FamilyMemberDocumentsService,
  ) {}

  @Post()
  @RequirePermissions(PERMISSIONS.CUSTOMER.UPDATE)
  create(@Param('customerId') customerId: string, @Body() dto: CreateFamilyMemberDto) {
    return this.familyMembersService.create(customerId, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.CUSTOMER.READ)
  list(@Param('customerId') customerId: string) {
    return this.familyMembersService.listForCustomer(customerId);
  }

  @Get(':memberId')
  @RequirePermissions(PERMISSIONS.CUSTOMER.READ)
  findOne(@Param('customerId') customerId: string, @Param('memberId') memberId: string) {
    return this.familyMembersService.getMember(memberId, customerId);
  }

  @Patch(':memberId')
  @RequirePermissions(PERMISSIONS.CUSTOMER.UPDATE)
  update(
    @Param('customerId') customerId: string,
    @Param('memberId') memberId: string,
    @Body() dto: UpdateFamilyMemberDto,
  ) {
    return this.familyMembersService.update(memberId, dto, customerId);
  }

  @Delete(':memberId')
  @RequirePermissions(PERMISSIONS.CUSTOMER.DELETE)
  async remove(@Param('customerId') customerId: string, @Param('memberId') memberId: string) {
    await this.familyMembersService.remove(memberId, customerId);
    return { deleted: true };
  }

  @Get(':memberId/documents')
  @RequirePermissions(PERMISSIONS.CUSTOMER.READ)
  async listDocuments(
    @Param('customerId') customerId: string,
    @Param('memberId') memberId: string,
  ) {
    await this.familyMembersService.getMember(memberId, customerId);
    return this.documentsService.listForMember(memberId);
  }

  @Post(':memberId/documents')
  @RequirePermissions(PERMISSIONS.CUSTOMER.UPDATE)
  @UseInterceptors(
    FileInterceptor('file', createDocumentMulterOptions(FAMILY_MEMBER_DOCUMENTS_NAMESPACE)),
  )
  async uploadDocument(
    @Param('customerId') customerId: string,
    @Param('memberId') memberId: string,
    @UploadedFile() file: Express.Multer.File,
    @Query() query: UploadDocumentQueryDto,
  ) {
    await this.familyMembersService.getMember(memberId, customerId);
    if (query.type === 'PASSPORT') {
      await assertImageIsReadableOrCleanup(
        documentFilePath(FAMILY_MEMBER_DOCUMENTS_NAMESPACE, file.filename),
        file.mimetype,
      );
    }
    return this.documentsService.recordUpload(memberId, file, query.type);
  }

  @Get(':memberId/documents/:documentId/file')
  @RequirePermissions(PERMISSIONS.CUSTOMER.READ)
  async downloadDocument(
    @Param('customerId') customerId: string,
    @Param('memberId') memberId: string,
    @Param('documentId') documentId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    await this.familyMembersService.getMember(memberId, customerId);
    const document = await this.documentsService.getDocument(documentId, memberId);
    res.set({
      'Content-Type': document.mimeType,
      'Content-Disposition': `inline; filename="${document.originalFileName}"`,
    });
    return new StreamableFile(
      fs.createReadStream(
        documentFilePath(FAMILY_MEMBER_DOCUMENTS_NAMESPACE, document.storedFileName),
      ),
    );
  }

  @Delete(':memberId/documents/:documentId')
  @RequirePermissions(PERMISSIONS.CUSTOMER.DELETE)
  async deleteDocument(
    @Param('customerId') customerId: string,
    @Param('memberId') memberId: string,
    @Param('documentId') documentId: string,
  ) {
    await this.familyMembersService.getMember(memberId, customerId);
    await this.documentsService.deleteDocument(documentId, memberId);
    return { deleted: true };
  }
}
