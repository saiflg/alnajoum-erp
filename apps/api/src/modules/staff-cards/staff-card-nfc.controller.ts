import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { isProductionEnv } from '../../common/security/runtime-environment';
import { resolveTenantFilter } from '../../common/utils/tenant.util';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import {
  BridgeVerifyDto,
  ConfirmEncodingDto,
  NfcCombinedVerifyDto,
  NfcProfileDto,
  NfcReaderDto,
  NfcUidVerifyDto,
  NfcVerifyDto,
  PrepareNfcDto,
  ReaderReportDto,
} from './dto/nfc.dto';
import { StaffCardNfcService } from './staff-card-nfc.service';
import {
  ScanContext,
  StaffCardVerificationService,
} from './staff-card-verification.service';

const SCAN_THROTTLE = { default: { ttl: 60_000, limit: 120 } } as const;
const BRIDGE_THROTTLE = { default: { ttl: 60_000, limit: 300 } } as const;
const PUBLIC_THROTTLE = { default: { ttl: 60_000, limit: 30 } } as const;

function companyOf(user: AuthContext): string {
  if (!user.companyId)
    throw new BadRequestException('Your account is not attached to a company.');
  return user.companyId;
}

/**
 * NFC configuration and verification for signed-in staff. A tap is checked on the server every time; the answer
 * comes from the card record, never from what the chip says about itself.
 */
@Controller('nfc')
export class StaffCardNfcController {
  constructor(
    private readonly nfc: StaffCardNfcService,
    private readonly verification: StaffCardVerificationService,
    private readonly prisma: PrismaService,
  ) {}

  // ---------------------------------------------------------------------------------------------- configuration

  @Get('capabilities')
  @RequirePermissions(PERMISSIONS.STAFF_CARD.READ)
  capabilities() {
    return this.nfc.capabilities();
  }

  @Get('overview')
  @RequirePermissions(PERMISSIONS.STAFF_CARD.READ)
  overview(@CurrentUser() user: AuthContext) {
    return this.nfc.overview(companyOf(user));
  }

  @Get('profiles')
  @RequirePermissions(PERMISSIONS.STAFF_CARD.READ)
  profiles(@CurrentUser() user: AuthContext) {
    return this.nfc.listProfiles(companyOf(user));
  }

  @Post('profiles')
  @RequirePermissions(PERMISSIONS.STAFF_CARD.NFC)
  createProfile(@CurrentUser() user: AuthContext, @Body() dto: NfcProfileDto) {
    return this.nfc.saveProfile(companyOf(user), dto, { identityId: user.sub });
  }

  @Put('profiles/:id')
  @RequirePermissions(PERMISSIONS.STAFF_CARD.NFC)
  updateProfile(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: NfcProfileDto,
  ) {
    return this.nfc.saveProfile(
      companyOf(user),
      dto,
      { identityId: user.sub },
      id,
    );
  }

  @Get('readers')
  @RequirePermissions(PERMISSIONS.STAFF_CARD.READ)
  readers(@CurrentUser() user: AuthContext) {
    return this.nfc.listReaders(companyOf(user));
  }

  @Post('readers')
  @RequirePermissions(PERMISSIONS.STAFF_CARD.NFC)
  createReader(@CurrentUser() user: AuthContext, @Body() dto: NfcReaderDto) {
    if (dto.adapter === 'MOCK' && isProductionEnv())
      throw new ForbiddenException(
        'The mock reader is not available in production.',
      );
    return this.nfc.createReader(companyOf(user), dto, {
      identityId: user.sub,
    });
  }

  @Put('readers/:id/active')
  @RequirePermissions(PERMISSIONS.STAFF_CARD.NFC)
  setActive(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body('isActive') isActive: boolean,
  ) {
    return this.nfc.setReaderActive(companyOf(user), id, isActive === true, {
      identityId: user.sub,
    });
  }

  /** A browser adapter says what its reader is doing (connected, disconnected, an error). */
  @Post('readers/:id/report')
  @Throttle(SCAN_THROTTLE)
  @RequirePermissions(PERMISSIONS.STAFF_CARD.SCAN)
  report(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: ReaderReportDto,
  ) {
    return this.nfc.report(companyOf(user), id, dto.status, dto.error);
  }

  @Get('batches')
  @RequirePermissions(PERMISSIONS.STAFF_CARD.READ)
  batches(@CurrentUser() user: AuthContext) {
    return this.nfc.batches(companyOf(user));
  }

  // ---------------------------------------------------------------------------------------------- issuance

  @Get('cards/:cardId')
  @RequirePermissions(PERMISSIONS.STAFF_CARD.READ)
  cardStatus(
    @CurrentUser() user: AuthContext,
    @Param('cardId') cardId: string,
  ) {
    return this.nfc.statusFor(companyOf(user), cardId);
  }

  @Post('cards/:cardId/prepare')
  @RequirePermissions(PERMISSIONS.STAFF_CARD.NFC)
  prepare(
    @CurrentUser() user: AuthContext,
    @Param('cardId') cardId: string,
    @Body() dto: PrepareNfcDto,
  ) {
    return this.nfc.prepare(companyOf(user), cardId, dto, {
      identityId: user.sub,
    });
  }

  @Post('cards/:cardId/confirm')
  @RequirePermissions(PERMISSIONS.STAFF_CARD.NFC)
  confirm(
    @CurrentUser() user: AuthContext,
    @Param('cardId') cardId: string,
    @Body() dto: ConfirmEncodingDto,
  ) {
    return this.nfc.confirmEncoding(companyOf(user), cardId, dto, {
      identityId: user.sub,
    });
  }

  // ---------------------------------------------------------------------------------------------- verification

  private async context(
    user: AuthContext,
    req: Request,
    base: { readerId?: string; simulated?: boolean },
    method: ScanContext['method'],
  ): Promise<ScanContext> {
    if (base.simulated && isProductionEnv())
      throw new ForbiddenException(
        'Simulated scans are not accepted in production.',
      );
    // A reader id only counts if it belongs to the caller's company; a mock reader always marks the scan simulated.
    const reader = base.readerId
      ? await this.prisma.nfcReaderDevice.findFirst({
          where: { id: base.readerId, companyId: user.companyId ?? '__none__' },
          select: { id: true, adapter: true },
        })
      : null;
    return {
      method,
      scannedByIdentityId: user.sub,
      scannerCompanyId: user.companyId ?? undefined,
      tenant: resolveTenantFilter(user),
      readerId: reader?.id,
      simulated: base.simulated === true || reader?.adapter === 'MOCK',
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    };
  }

  @Post('verify')
  @Throttle(SCAN_THROTTLE)
  @RequirePermissions(PERMISSIONS.STAFF_CARD.SCAN)
  async verify(
    @CurrentUser() user: AuthContext,
    @Body() dto: NfcVerifyDto,
    @Req() req: Request,
  ) {
    return this.verification.verifyNfc(
      dto.payload,
      await this.context(user, req, dto, 'NFC'),
    );
  }

  @Post('verify-uid')
  @Throttle(SCAN_THROTTLE)
  @RequirePermissions(PERMISSIONS.STAFF_CARD.SCAN)
  async verifyUid(
    @CurrentUser() user: AuthContext,
    @Body() dto: NfcUidVerifyDto,
    @Req() req: Request,
  ) {
    return this.verification.verifyUid(
      dto.uid,
      await this.context(user, req, dto, 'NFC_UID'),
    );
  }

  @Post('verify-both')
  @Throttle(SCAN_THROTTLE)
  @RequirePermissions(PERMISSIONS.STAFF_CARD.SCAN)
  async verifyBoth(
    @CurrentUser() user: AuthContext,
    @Body() dto: NfcCombinedVerifyDto,
    @Req() req: Request,
  ) {
    return this.verification.verifyCombined(
      dto.qr,
      dto.nfc,
      await this.context(user, req, dto, 'QR_AND_NFC'),
    );
  }
}

/**
 * Public side of NFC: what a phone shows when it taps a card (status only, as for the QR link), and the two calls a
 * local reader bridge makes with its own secret. A bridge secret allows verification and a status report - nothing else.
 */
@Controller('public/nfc')
export class StaffCardNfcPublicController {
  constructor(
    private readonly nfc: StaffCardNfcService,
    private readonly verification: StaffCardVerificationService,
  ) {}

  @Public()
  @Throttle(PUBLIC_THROTTLE)
  @Get('card/:ref')
  card(@Param('ref') ref: string, @Req() req: Request) {
    return this.verification.verifyNfc(ref, {
      method: 'PUBLIC_NFC_LINK',
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  private async reader(token: string | undefined) {
    const r = token ? await this.nfc.readerForToken(token) : null;
    if (!r) throw new UnauthorizedException();
    return r;
  }

  @Public()
  @Post('bridge/heartbeat')
  @Throttle(BRIDGE_THROTTLE)
  async heartbeat(
    @Headers('x-reader-token') token: string | undefined,
    @Body() dto: ReaderReportDto,
  ) {
    const r = await this.reader(token);
    return this.nfc.report(r.companyId, r.id, dto.status, dto.error);
  }

  @Public()
  @Post('bridge/verify')
  @Throttle(BRIDGE_THROTTLE)
  async bridgeVerify(
    @Headers('x-reader-token') token: string | undefined,
    @Body() dto: BridgeVerifyDto,
    @Req() req: Request,
  ) {
    const r = await this.reader(token);
    return this.verification.verifyNfc(dto.payload, {
      method: 'NFC',
      readerId: r.id,
      simulated: false,
      tenant: r.companyId,
      scannerCompanyId: r.companyId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
