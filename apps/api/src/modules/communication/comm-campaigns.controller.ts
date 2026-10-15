import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { isProductionEnv } from '../../common/security/runtime-environment';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { Actor, CommCampaignsService } from './comm-campaigns.service';
import { CommDeliveryService } from './comm-delivery.service';
import { CommSenderService } from './comm-sender.service';
import {
  ApproveCampaignDto,
  CreateCampaignDto,
  ListCampaignsQueryDto,
  ReasonDto,
  RecipientsQueryDto,
  SimulateEmailEventDto,
  TestSendDto,
  UpdateCampaignDto,
} from './dto/comm-campaign.dto';

function companyOf(user: AuthContext): string {
  if (!user.companyId)
    throw new BadRequestException('Your account is not attached to a company.');
  return user.companyId;
}

@Controller('comm')
export class CommCampaignsController {
  constructor(
    private readonly campaigns: CommCampaignsService,
    private readonly sender: CommSenderService,
    private readonly delivery: CommDeliveryService,
    private readonly prisma: PrismaService,
  ) {}

  private actor(user: AuthContext, email?: string | null): Actor {
    return { identityId: user.sub, roles: user.roles, email };
  }

  // ---------------------------------------------------------------------------------------------- reads

  @Get('campaigns/summary')
  @RequirePermissions(PERMISSIONS.COMM.REPORT_VIEW)
  summary(@CurrentUser() user: AuthContext) {
    return this.campaigns.summary(companyOf(user));
  }

  @Get('campaigns')
  @RequirePermissions(PERMISSIONS.COMM.CAMPAIGN_READ)
  list(@CurrentUser() user: AuthContext, @Query() q: ListCampaignsQueryDto) {
    return this.campaigns.list(companyOf(user), q);
  }

  @Get('campaigns/:id')
  @RequirePermissions(PERMISSIONS.COMM.CAMPAIGN_READ)
  get(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.campaigns.get(companyOf(user), id);
  }

  @Get('campaigns/:id/preview')
  @RequirePermissions(PERMISSIONS.COMM.CAMPAIGN_READ)
  preview(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.campaigns.preview(companyOf(user), id);
  }

  @Get('campaigns/:id/report')
  @RequirePermissions(PERMISSIONS.COMM.REPORT_VIEW)
  report(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.campaigns.report(companyOf(user), id);
  }

  @Get('campaigns/:id/recipients')
  @RequirePermissions(PERMISSIONS.COMM.REPORT_VIEW)
  recipients(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Query() q: RecipientsQueryDto,
  ) {
    return this.campaigns.recipients(companyOf(user), id, q);
  }

  // ---------------------------------------------------------------------------------------------- writing

  @Post('campaigns')
  @RequirePermissions(PERMISSIONS.COMM.CAMPAIGN_CREATE)
  create(@CurrentUser() user: AuthContext, @Body() dto: CreateCampaignDto) {
    return this.campaigns.create(companyOf(user), dto, this.actor(user));
  }

  @Put('campaigns/:id')
  @RequirePermissions(PERMISSIONS.COMM.CAMPAIGN_CREATE)
  update(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateCampaignDto,
  ) {
    return this.campaigns.update(companyOf(user), id, dto, this.actor(user));
  }

  @Delete('campaigns/:id')
  @RequirePermissions(PERMISSIONS.COMM.CAMPAIGN_CREATE)
  remove(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.campaigns.remove(companyOf(user), id, this.actor(user));
  }

  @Post('campaigns/:id/submit')
  @RequirePermissions(PERMISSIONS.COMM.CAMPAIGN_CREATE)
  submit(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.campaigns.submit(companyOf(user), id, this.actor(user));
  }

  @Post('campaigns/:id/withdraw')
  @RequirePermissions(PERMISSIONS.COMM.CAMPAIGN_CREATE)
  withdraw(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.campaigns.withdraw(companyOf(user), id, this.actor(user));
  }

  @Post('campaigns/:id/test')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @RequirePermissions(PERMISSIONS.COMM.CAMPAIGN_CREATE)
  async test(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: TestSendDto,
  ) {
    const me = await this.prisma.identity.findUnique({
      where: { id: user.sub },
      select: { email: true },
    });
    return this.campaigns.testSend(
      companyOf(user),
      id,
      dto.to,
      this.actor(user, me?.email),
    );
  }

  // ---------------------------------------------------------------------------------------------- approval and sending

  @Post('campaigns/:id/approve')
  @RequirePermissions(PERMISSIONS.COMM.CAMPAIGN_APPROVE)
  approve(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: ApproveCampaignDto,
  ) {
    return this.campaigns.approve(
      companyOf(user),
      id,
      {
        ...dto.confirm,
        segmentId: dto.confirm.segmentId ?? null,
        templateId: dto.confirm.templateId ?? null,
        scheduledAt: dto.confirm.scheduledAt ?? null,
      },
      dto.note,
      this.actor(user),
    );
  }

  @Post('campaigns/:id/reject')
  @RequirePermissions(PERMISSIONS.COMM.CAMPAIGN_APPROVE)
  reject(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.campaigns.reject(
      companyOf(user),
      id,
      dto.reason,
      this.actor(user),
    );
  }

  @Post('campaigns/:id/start')
  @RequirePermissions(PERMISSIONS.COMM.CAMPAIGN_SEND)
  start(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.campaigns.start(companyOf(user), id, this.actor(user));
  }

  @Post('campaigns/:id/pause')
  @RequirePermissions(PERMISSIONS.COMM.CAMPAIGN_SEND)
  pause(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.campaigns.pause(companyOf(user), id, this.actor(user));
  }

  @Post('campaigns/:id/resume')
  @RequirePermissions(PERMISSIONS.COMM.CAMPAIGN_SEND)
  resume(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.campaigns.resume(companyOf(user), id, this.actor(user));
  }

  @Post('campaigns/:id/cancel')
  @RequirePermissions(PERMISSIONS.COMM.CAMPAIGN_SEND)
  cancel(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.campaigns.cancel(
      companyOf(user),
      id,
      dto.reason,
      this.actor(user),
    );
  }

  // ---------------------------------------------------------------------------------------------- local testing aids

  /** Runs one sending pass now instead of waiting for the timer. It obeys every rule the timer does. Not in production. */
  @Post('campaigns/maintenance/process')
  @RequirePermissions(PERMISSIONS.COMM.CAMPAIGN_SEND)
  async processNow() {
    if (isProductionEnv())
      throw new ForbiddenException(
        'The sending queue runs on its own in production.',
      );
    return (
      (await this.sender.tick()) ?? { skipped: 'A pass is already running.' }
    );
  }

  /**
   * Feeds a delivery report into the same code a real provider's webhook uses, flagged as simulated. Lets bounce and
   * complaint handling be tried without a provider. Not available in production.
   */
  @Post('dev/email-event')
  @RequirePermissions(PERMISSIONS.COMM.SETTINGS_MANAGE)
  async simulate(@Body() dto: SimulateEmailEventDto) {
    if (isProductionEnv())
      throw new ForbiddenException(
        'Simulated events are not available in production.',
      );
    const outcome = await this.delivery.apply({
      channel: 'EMAIL',
      providerMessageId: dto.providerMessageId,
      type: dto.type,
      occurredAt: new Date(),
      providerEventId: `sim:${dto.providerMessageId}:${dto.type}:${Date.now()}`,
      simulated: true,
      detail: 'Simulated event',
      hardBounce: true,
    });
    return { outcome, simulated: true };
  }
}
