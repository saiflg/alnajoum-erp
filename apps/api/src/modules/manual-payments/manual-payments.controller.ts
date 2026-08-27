import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ManualPaymentStatus } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import {
  createDocumentMulterOptions,
} from '../../common/documents/document-storage.util';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { ReviewManualPaymentDto } from './dto/review-manual-payment.dto';
import { SubmitManualPaymentDto } from './dto/submit-manual-payment.dto';
import { ManualPaymentsService } from './manual-payments.service';

const NAMESPACE = 'manual-payment-receipts';

/**
 * Staff-submit / finance-review workflow for offline (cash / bank transfer)
 * payments. Submitting is `MANUAL_PAYMENT.SUBMIT` (front-line staff);
 * approving, rejecting, or requesting clarification is `MANUAL_PAYMENT.REVIEW`
 * (Finance) — see permissions.constant.ts.
 */
@Controller('manual-payments')
export class ManualPaymentsController {
  constructor(
    private readonly manualPaymentsService: ManualPaymentsService,
    private readonly usersService: UsersService,
  ) {}

  @Post()
  @RequirePermissions(PERMISSIONS.MANUAL_PAYMENT.SUBMIT)
  async submit(
    @CurrentUser() user: AuthContext,
    @Body() dto: SubmitManualPaymentDto,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    return this.manualPaymentsService.submit(
      dto.customerId,
      dto,
      staffId ?? undefined,
      user.sub,
    );
  }

  @Post(':id/receipt')
  @RequirePermissions(PERMISSIONS.MANUAL_PAYMENT.SUBMIT)
  @UseInterceptors(FileInterceptor('file', createDocumentMulterOptions(NAMESPACE)))
  async attachReceipt(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.manualPaymentsService.attachReceipt(id, file.filename);
  }

  @Get('pending')
  @RequirePermissions(PERMISSIONS.MANUAL_PAYMENT.REVIEW)
  listPending() {
    return this.manualPaymentsService.listPending();
  }

  @Get()
  @RequirePermissions(PERMISSIONS.MANUAL_PAYMENT.REVIEW)
  listAll(
    @Query('customerId') customerId?: string,
    @Query('status') status?: ManualPaymentStatus,
  ) {
    return this.manualPaymentsService.listAll({ customerId, status });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.MANUAL_PAYMENT.REVIEW)
  getOne(@Param('id') id: string) {
    return this.manualPaymentsService.getOne(id);
  }

  @Post(':id/approve')
  @RequirePermissions(PERMISSIONS.MANUAL_PAYMENT.REVIEW)
  async approve(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: ReviewManualPaymentDto,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    return this.manualPaymentsService.approve(
      id,
      staffId ?? undefined,
      dto.note,
      user.sub,
    );
  }

  @Post(':id/reject')
  @RequirePermissions(PERMISSIONS.MANUAL_PAYMENT.REVIEW)
  async reject(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: ReviewManualPaymentDto,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    return this.manualPaymentsService.reject(
      id,
      staffId ?? undefined,
      dto.note,
      user.sub,
    );
  }

  @Post(':id/request-clarification')
  @RequirePermissions(PERMISSIONS.MANUAL_PAYMENT.REVIEW)
  async requestClarification(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: ReviewManualPaymentDto,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    return this.manualPaymentsService.requestClarification(
      id,
      staffId ?? undefined,
      dto.note ?? 'Please provide additional details.',
      user.sub,
    );
  }
}
