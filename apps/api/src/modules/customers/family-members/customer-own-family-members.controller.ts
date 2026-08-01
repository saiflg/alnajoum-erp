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
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import {
  createDocumentMulterOptions,
  documentFilePath,
} from '../../../common/documents/document-storage.util';
import { assertImageIsReadableOrCleanup } from '../../../common/documents/image-quality.util';
import type { AuthContext } from '../../../common/interfaces/auth-context.interface';
import { CustomersService } from '../customers.service';
import { UploadDocumentQueryDto } from '../documents/dto/upload-document-query.dto';
import {
  FAMILY_MEMBER_DOCUMENTS_NAMESPACE,
  FamilyMemberDocumentsService,
} from './documents/family-member-documents.service';
import { CreateFamilyMemberDto } from './dto/create-family-member.dto';
import { UpdateFamilyMemberDto } from './dto/update-family-member.dto';
import { FamilyMembersService } from './family-members.service';

@Controller('customers/me/family-members')
export class CustomerOwnFamilyMembersController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly familyMembersService: FamilyMembersService,
    private readonly documentsService: FamilyMemberDocumentsService,
  ) {}

  @Post()
  async create(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateFamilyMemberDto,
  ) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    return this.familyMembersService.create(customerId, dto);
  }

  @Get()
  async list(@CurrentUser() user: AuthContext) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    return this.familyMembersService.listForCustomer(customerId);
  }

  @Get(':memberId')
  async findOne(
    @CurrentUser() user: AuthContext,
    @Param('memberId') memberId: string,
  ) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    return this.familyMembersService.getMember(memberId, customerId);
  }

  @Patch(':memberId')
  async update(
    @CurrentUser() user: AuthContext,
    @Param('memberId') memberId: string,
    @Body() dto: UpdateFamilyMemberDto,
  ) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    return this.familyMembersService.update(memberId, dto, customerId);
  }

  @Delete(':memberId')
  async remove(
    @CurrentUser() user: AuthContext,
    @Param('memberId') memberId: string,
  ) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    await this.familyMembersService.remove(memberId, customerId);
    return { deleted: true };
  }

  @Post(':memberId/documents')
  @UseInterceptors(
    FileInterceptor(
      'file',
      createDocumentMulterOptions(FAMILY_MEMBER_DOCUMENTS_NAMESPACE),
    ),
  )
  async uploadDocument(
    @CurrentUser() user: AuthContext,
    @Param('memberId') memberId: string,
    @UploadedFile() file: Express.Multer.File,
    @Query() query: UploadDocumentQueryDto,
  ) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    await this.familyMembersService.getMember(memberId, customerId);
    if (query.type === 'PASSPORT') {
      await assertImageIsReadableOrCleanup(
        documentFilePath(FAMILY_MEMBER_DOCUMENTS_NAMESPACE, file.filename),
        file.mimetype,
      );
    }
    return this.documentsService.recordUpload(memberId, file, query.type);
  }

  @Get(':memberId/documents')
  async listDocuments(
    @CurrentUser() user: AuthContext,
    @Param('memberId') memberId: string,
  ) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    await this.familyMembersService.getMember(memberId, customerId);
    return this.documentsService.listForMember(memberId);
  }

  @Get(':memberId/documents/:documentId/file')
  async downloadDocument(
    @CurrentUser() user: AuthContext,
    @Param('memberId') memberId: string,
    @Param('documentId') documentId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    await this.familyMembersService.getMember(memberId, customerId);
    const document = await this.documentsService.getDocument(
      documentId,
      memberId,
    );
    res.set({
      'Content-Type': document.mimeType,
      'Content-Disposition': `inline; filename="${document.originalFileName}"`,
    });
    return new StreamableFile(
      fs.createReadStream(
        documentFilePath(
          FAMILY_MEMBER_DOCUMENTS_NAMESPACE,
          document.storedFileName,
        ),
      ),
    );
  }

  @Delete(':memberId/documents/:documentId')
  async deleteDocument(
    @CurrentUser() user: AuthContext,
    @Param('memberId') memberId: string,
    @Param('documentId') documentId: string,
  ) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    await this.familyMembersService.getMember(memberId, customerId);
    await this.documentsService.deleteDocument(documentId, memberId);
    return { deleted: true };
  }
}
