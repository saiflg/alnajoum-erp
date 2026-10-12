import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { createDocumentMulterOptions } from '../../common/documents/document-storage.util';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { TenantScoped } from '../../common/tenancy/tenant-scoped.decorator';
import { resolveTenantFilter } from '../../common/utils/tenant.util';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import {
  IssueCardDto,
  ListCardsQueryDto,
  PrintCardsDto,
  RenewCardDto,
  ReplaceCardDto,
  RequiredReasonDto,
  ScanHistoryQueryDto,
  UpdateCardSettingsDto,
  VerifyLookupDto,
} from './dto/staff-cards.dto';
import {
  CARD_ASSET_NAMESPACE,
  STAFF_PHOTO_NAMESPACE,
  readCardImage,
} from './staff-card-images';
import { StaffCardRenderService } from './staff-card-render.service';
import { StaffCardSettingsService } from './staff-card-settings.service';
import {
  ScanContext,
  StaffCardVerificationService,
} from './staff-card-verification.service';
import { CardActor, StaffCardsService } from './staff-cards.service';

// Signed-in lookups confirm whether a record exists, so they are limited per client even for staff.
const SCAN_THROTTLE = { default: { ttl: 60_000, limit: 90 } } as const;

@Controller('staff-cards')
export class StaffCardsController {
  constructor(
    private readonly cards: StaffCardsService,
    private readonly render: StaffCardRenderService,
    private readonly settings: StaffCardSettingsService,
    private readonly verification: StaffCardVerificationService,
    private readonly prisma: PrismaService,
  ) {}

  private async actor(user: AuthContext): Promise<CardActor> {
    const staff = await this.prisma.staff.findUnique({
      where: { identityId: user.sub },
      select: { id: true },
    });
    return { identityId: user.sub, staffId: staff?.id ?? null };
  }

  /** The company whose design/settings the caller works with: their own, even for a platform administrator. */
  private companyOf(user: AuthContext): string {
    if (!user.companyId)
      throw new BadRequestException(
        'Your account is not attached to a company.',
      );
    return user.companyId;
  }

  private pdf(res: Response, filename: string): void {
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'no-store',
    });
  }

  // ---------------------------------------------------------------------------------------------- overview

  @Get('dashboard')
  @RequirePermissions(PERMISSIONS.STAFF_CARD.READ)
  dashboard(@CurrentUser() user: AuthContext) {
    return this.cards.dashboard(resolveTenantFilter(user));
  }

  @Get()
  @RequirePermissions(PERMISSIONS.STAFF_CARD.READ)
  list(@CurrentUser() user: AuthContext, @Query() q: ListCardsQueryDto) {
    return this.cards.list(q, resolveTenantFilter(user));
  }

  @Get('staff-without-card')
  @RequirePermissions(PERMISSIONS.STAFF_CARD.MANAGE)
  staffWithoutCard(
    @CurrentUser() user: AuthContext,
    @Query('search') search?: string,
  ) {
    return this.cards.staffWithoutCard(
      resolveTenantFilter(user),
      search?.slice(0, 80),
    );
  }

  @Get('scans')
  @RequirePermissions(PERMISSIONS.STAFF_CARD.SCAN)
  scans(@CurrentUser() user: AuthContext, @Query() q: ScanHistoryQueryDto) {
    return this.cards.scanHistory(q, resolveTenantFilter(user));
  }

  /** The signed-in staff member's own current card as a PDF. */
  @Get('mine')
  async mine(
    @CurrentUser() user: AuthContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const a = await this.actor(user);
    if (!a.staffId)
      throw new NotFoundException('No staff record for this account');
    const card = await this.prisma.staffIdCard.findFirst({
      where: { staffId: a.staffId, status: { in: ['ACTIVE', 'PENDING'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, companyId: true },
    });
    if (!card)
      throw new NotFoundException(
        'No identification card has been issued to you yet. Ask your administrator.',
      );
    const { stream, filename } = await this.render.render(
      [card.id],
      'cards',
      card.companyId,
    );
    this.pdf(res, filename);
    return new StreamableFile(stream);
  }

  // ---------------------------------------------------------------------------------------------- verification

  /** The scanner page: check a scanned code or a typed reference against the live database. */
  @Post('verify')
  @Throttle(SCAN_THROTTLE)
  @RequirePermissions(PERMISSIONS.STAFF_CARD.SCAN)
  async verify(
    @CurrentUser() user: AuthContext,
    @Body() dto: VerifyLookupDto,
    @Req() req: Request,
  ) {
    const tenant = resolveTenantFilter(user);
    const ctx: ScanContext = {
      method: dto.method,
      scannedByIdentityId: user.sub,
      scannerCompanyId: user.companyId ?? undefined,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    };
    if (dto.method === 'QR') {
      const token = this.verification.parseScanned(dto.value);
      return this.verification.verifyToken(token ?? dto.value, ctx);
    }
    if (dto.method === 'MANUAL_STAFF_ID')
      return this.verification.verifyStaffId(dto.value, ctx, tenant);
    return this.verification.verifyReference(dto.value, ctx, tenant);
  }

  // ---------------------------------------------------------------------------------------------- settings

  @Get('settings')
  @RequirePermissions(PERMISSIONS.STAFF_CARD.READ)
  async getSettings(@CurrentUser() user: AuthContext) {
    const companyId = this.companyOf(user);
    const s = await this.settings.get(companyId);
    const dataUrl = (b: Buffer | null) =>
      b ? `data:image/png;base64,${b.toString('base64')}` : null;
    return {
      ...s,
      logoDataUrl: dataUrl(await this.settings.assetBuffer(companyId, 'logo')),
      signatureDataUrl: dataUrl(
        await this.settings.assetBuffer(companyId, 'signature'),
      ),
    };
  }

  @Put('settings')
  @RequirePermissions(PERMISSIONS.STAFF_CARD.SETTINGS)
  updateSettings(
    @CurrentUser() user: AuthContext,
    @Body() dto: UpdateCardSettingsDto,
  ) {
    return this.settings.update(this.companyOf(user), dto, user.sub);
  }

  @Post('settings/logo')
  @RequirePermissions(PERMISSIONS.STAFF_CARD.SETTINGS)
  @UseInterceptors(
    FileInterceptor('file', createDocumentMulterOptions(CARD_ASSET_NAMESPACE)),
  )
  async uploadLogo(
    @CurrentUser() user: AuthContext,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Choose an image to upload.');
    await this.settings.setAsset(this.companyOf(user), 'logo', file, user.sub);
    return { saved: true };
  }

  @Post('settings/signature')
  @RequirePermissions(PERMISSIONS.STAFF_CARD.SETTINGS)
  @UseInterceptors(
    FileInterceptor('file', createDocumentMulterOptions(CARD_ASSET_NAMESPACE)),
  )
  async uploadSignature(
    @CurrentUser() user: AuthContext,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Choose an image to upload.');
    await this.settings.setAsset(
      this.companyOf(user),
      'signature',
      file,
      user.sub,
    );
    return { saved: true };
  }

  @Delete('settings/logo')
  @RequirePermissions(PERMISSIONS.STAFF_CARD.SETTINGS)
  async removeLogo(@CurrentUser() user: AuthContext) {
    await this.settings.removeAsset(this.companyOf(user), 'logo', user.sub);
    return { removed: true };
  }

  @Delete('settings/signature')
  @RequirePermissions(PERMISSIONS.STAFF_CARD.SETTINGS)
  async removeSignature(@CurrentUser() user: AuthContext) {
    await this.settings.removeAsset(
      this.companyOf(user),
      'signature',
      user.sub,
    );
    return { removed: true };
  }

  // ---------------------------------------------------------------------------------------------- staff photograph

  @TenantScoped({ kind: 'staff', param: 'staffId' })
  @Post('staff/:staffId/photo')
  @RequirePermissions(PERMISSIONS.STAFF_CARD.MANAGE)
  @UseInterceptors(
    FileInterceptor('file', createDocumentMulterOptions(STAFF_PHOTO_NAMESPACE)),
  )
  async uploadPhoto(
    @CurrentUser() user: AuthContext,
    @Param('staffId') staffId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Choose a photograph to upload.');
    return this.cards.setPhoto(
      staffId,
      file,
      await this.actor(user),
      resolveTenantFilter(user),
    );
  }

  @TenantScoped({ kind: 'staff', param: 'staffId' })
  @Get('staff/:staffId/photo')
  @RequirePermissions(PERMISSIONS.STAFF_CARD.READ)
  async photo(
    @Param('staffId') staffId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const staff = await this.prisma.staff.findUnique({
      where: { id: staffId },
      select: { photoFilename: true },
    });
    const bytes = await readCardImage(
      STAFF_PHOTO_NAMESPACE,
      staff?.photoFilename,
    );
    if (!bytes) throw new NotFoundException('No photograph on file');
    res.set({
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(bytes);
  }

  // ---------------------------------------------------------------------------------------------- actions

  @Post()
  @RequirePermissions(PERMISSIONS.STAFF_CARD.MANAGE)
  async issue(@CurrentUser() user: AuthContext, @Body() dto: IssueCardDto) {
    return this.cards.issue(
      dto,
      await this.actor(user),
      resolveTenantFilter(user),
    );
  }

  @Post('print')
  @RequirePermissions(PERMISSIONS.STAFF_CARD.MANAGE)
  async print(
    @CurrentUser() user: AuthContext,
    @Body() dto: PrintCardsDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const tenant = resolveTenantFilter(user);
    const { stream, filename, printed } = await this.render.render(
      dto.cardIds,
      dto.layout ?? 'cards',
      tenant,
    );
    await this.cards.recordPrint(printed, await this.actor(user), tenant);
    this.pdf(res, filename);
    return new StreamableFile(stream);
  }

  @Post('maintenance/sweep')
  @RequirePermissions(PERMISSIONS.STAFF_CARD.MANAGE)
  sweep() {
    return this.cards.sweep();
  }

  // ---------------------------------------------------------------------------------------------- one card

  @TenantScoped('staffIdCard')
  @Get(':id')
  @RequirePermissions(PERMISSIONS.STAFF_CARD.READ)
  get(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.cards.get(id, resolveTenantFilter(user));
  }

  @TenantScoped('staffIdCard')
  @Get(':id/history')
  @RequirePermissions(PERMISSIONS.STAFF_CARD.READ)
  history(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.cards.history(id, resolveTenantFilter(user));
  }

  @TenantScoped('staffIdCard')
  @Get(':id/preview')
  @RequirePermissions(PERMISSIONS.STAFF_CARD.READ)
  preview(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.render.preview(id, resolveTenantFilter(user));
  }

  @TenantScoped('staffIdCard')
  @Get(':id/pdf')
  @RequirePermissions(PERMISSIONS.STAFF_CARD.READ)
  async pdfOf(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, filename } = await this.render.render(
      [id],
      'cards',
      resolveTenantFilter(user),
    );
    this.pdf(res, filename);
    return new StreamableFile(stream);
  }

  @TenantScoped('staffIdCard')
  @Post(':id/activate')
  @RequirePermissions(PERMISSIONS.STAFF_CARD.MANAGE)
  async activate(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.cards.activate(
      id,
      await this.actor(user),
      resolveTenantFilter(user),
    );
  }

  @TenantScoped('staffIdCard')
  @Post(':id/renew')
  @RequirePermissions(PERMISSIONS.STAFF_CARD.MANAGE)
  async renew(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: RenewCardDto,
  ) {
    return this.cards.renew(
      id,
      dto,
      await this.actor(user),
      resolveTenantFilter(user),
    );
  }

  @TenantScoped('staffIdCard')
  @Post(':id/suspend')
  @RequirePermissions(PERMISSIONS.STAFF_CARD.MANAGE)
  async suspend(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: RequiredReasonDto,
  ) {
    return this.cards.suspend(
      id,
      dto.reason,
      await this.actor(user),
      resolveTenantFilter(user),
    );
  }

  @TenantScoped('staffIdCard')
  @Post(':id/reinstate')
  @RequirePermissions(PERMISSIONS.STAFF_CARD.MANAGE)
  async reinstate(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: RequiredReasonDto,
  ) {
    return this.cards.reinstate(
      id,
      dto.reason,
      await this.actor(user),
      resolveTenantFilter(user),
    );
  }

  @TenantScoped('staffIdCard')
  @Post(':id/revoke')
  @RequirePermissions(PERMISSIONS.STAFF_CARD.MANAGE)
  async revoke(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: RequiredReasonDto,
  ) {
    return this.cards.revoke(
      id,
      dto.reason,
      await this.actor(user),
      resolveTenantFilter(user),
    );
  }

  @TenantScoped('staffIdCard')
  @Post(':id/replace')
  @RequirePermissions(PERMISSIONS.STAFF_CARD.MANAGE)
  async replace(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: ReplaceCardDto,
  ) {
    return this.cards.replace(
      id,
      dto,
      await this.actor(user),
      resolveTenantFilter(user),
    );
  }
}
