import {
  Body,
  Controller,
  Get,
  Ip,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IncidentStatus } from '@prisma/client';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { CREDENTIAL_THROTTLE } from '../../common/security/throttle-limits';
import { RequireStepUp } from '../../common/security/step-up';
import { TenantScoped } from '../../common/tenancy/tenant-scoped.decorator';
import { resolveTenantFilter } from '../../common/utils/tenant.util';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { AccessReviewsService } from './access-reviews.service';
import { BreakGlassService } from './break-glass.service';
import {
  BreakGlassRequestDto,
  EraseCustomerDto,
  IncidentNoteDto,
  IncidentStatusDto,
  OpenIncidentDto,
  ReviewDecisionDto,
  StepUpDto,
} from './dto/security.dto';
import { IncidentsService } from './incidents.service';
import { PrivacyService } from './privacy.service';
import { RetentionService } from './retention.service';
import { SecurityOverviewService } from './security-overview.service';
import { StepUpService } from './step-up.service';

/**
 * Security operations: dashboard and control register, incidents, access reviews, customer privacy requests,
 * retention, break-glass access. Everything is confined to the caller's company; the platform-level pieces
 * (retention, approving break-glass) are SUPER_ADMIN only.
 */
@Controller('security')
export class SecurityController {
  constructor(
    private readonly overview: SecurityOverviewService,
    private readonly incidents: IncidentsService,
    private readonly reviews: AccessReviewsService,
    private readonly privacy: PrivacyService,
    private readonly retention: RetentionService,
    private readonly breakGlass: BreakGlassService,
    private readonly stepUp: StepUpService,
  ) {}

  private who(user: AuthContext) {
    return { identityId: user.sub, companyId: user.companyId };
  }

  // ---------------------------------------------------------------- step-up (any signed-in user)
  @Post('step-up')
  @Throttle(CREDENTIAL_THROTTLE)
  @RequirePermissions()
  issueStepUp(
    @CurrentUser() user: AuthContext,
    @Body() dto: StepUpDto,
    @Req() req: Request,
    @Ip() ip: string,
  ) {
    return this.stepUp.issue(user.sub, dto, {
      ipAddress: ip,
      userAgent: req.headers['user-agent'],
    });
  }

  // ---------------------------------------------------------------- dashboard
  @Get('overview')
  @RequirePermissions(PERMISSIONS.SECURITY.VIEW)
  getOverview(@CurrentUser() user: AuthContext) {
    return this.overview.overview(resolveTenantFilter(user));
  }

  @Get('controls')
  @RequirePermissions(PERMISSIONS.SECURITY.VIEW)
  getControls(@CurrentUser() user: AuthContext) {
    return this.overview.controls(resolveTenantFilter(user));
  }

  // ---------------------------------------------------------------- incidents
  @Get('incidents')
  @RequirePermissions(PERMISSIONS.SECURITY.VIEW)
  listIncidents(
    @CurrentUser() user: AuthContext,
    @Query('status') status?: IncidentStatus,
  ) {
    return this.incidents.list(resolveTenantFilter(user), status);
  }

  @Post('incidents')
  @RequirePermissions(PERMISSIONS.SECURITY.INCIDENT_MANAGE)
  openIncident(@CurrentUser() user: AuthContext, @Body() dto: OpenIncidentDto) {
    return this.incidents.open(dto, this.who(user));
  }

  @Get('incidents/:id')
  @RequirePermissions(PERMISSIONS.SECURITY.VIEW)
  getIncident(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.incidents.get(id, resolveTenantFilter(user));
  }

  @Post('incidents/:id/notes')
  @RequirePermissions(PERMISSIONS.SECURITY.INCIDENT_MANAGE)
  addIncidentNote(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: IncidentNoteDto,
  ) {
    return this.incidents.addNote(
      id,
      dto.body,
      this.who(user),
      resolveTenantFilter(user),
    );
  }

  @Post('incidents/:id/status')
  @RequirePermissions(PERMISSIONS.SECURITY.INCIDENT_MANAGE)
  changeIncidentStatus(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: IncidentStatusDto,
  ) {
    return this.incidents.changeStatus(
      id,
      dto.status,
      dto.note,
      this.who(user),
      resolveTenantFilter(user),
    );
  }

  // ---------------------------------------------------------------- access reviews
  @Get('access-reviews')
  @RequirePermissions(PERMISSIONS.SECURITY.VIEW)
  listReviews(@CurrentUser() user: AuthContext) {
    return this.reviews.list(resolveTenantFilter(user));
  }

  @Post('access-reviews')
  @RequirePermissions(PERMISSIONS.SECURITY.ACCESS_REVIEW)
  startReview(@CurrentUser() user: AuthContext) {
    return this.reviews.start(this.who(user));
  }

  @Get('access-reviews/:id')
  @RequirePermissions(PERMISSIONS.SECURITY.VIEW)
  getReview(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.reviews.get(id, resolveTenantFilter(user));
  }

  @Post('access-reviews/:id/items/:itemId/decision')
  @RequirePermissions(PERMISSIONS.SECURITY.ACCESS_REVIEW)
  decide(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: ReviewDecisionDto,
  ) {
    return this.reviews.decide(
      id,
      itemId,
      dto.decision,
      dto.note,
      this.who(user),
      resolveTenantFilter(user),
    );
  }

  @Post('access-reviews/:id/complete')
  @RequireStepUp()
  @RequirePermissions(PERMISSIONS.SECURITY.ACCESS_REVIEW)
  completeReview(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.reviews.complete(id, this.who(user), resolveTenantFilter(user));
  }

  // ---------------------------------------------------------------- privacy (customer data requests)
  @Get('privacy/requests')
  @RequirePermissions(PERMISSIONS.SECURITY.PRIVACY_MANAGE)
  listPrivacyRequests(@CurrentUser() user: AuthContext) {
    return this.privacy.listRequests(resolveTenantFilter(user));
  }

  @Get('privacy/customers/:customerId/export')
  @TenantScoped({ kind: 'customer', param: 'customerId' })
  @RequireStepUp()
  @RequirePermissions(PERMISSIONS.SECURITY.PRIVACY_MANAGE)
  exportCustomer(
    @CurrentUser() user: AuthContext,
    @Param('customerId') customerId: string,
  ) {
    return this.privacy.exportData(
      customerId,
      this.who(user),
      resolveTenantFilter(user),
    );
  }

  @Get('privacy/customers/:customerId/erasure-check')
  @TenantScoped({ kind: 'customer', param: 'customerId' })
  @RequirePermissions(PERMISSIONS.SECURITY.PRIVACY_MANAGE)
  async erasureCheck(@Param('customerId') customerId: string) {
    const blockers = await this.privacy.erasureBlockers(customerId);
    return { canErase: blockers.length === 0, blockers };
  }

  @Post('privacy/customers/:customerId/erase')
  @TenantScoped({ kind: 'customer', param: 'customerId' })
  @RequireStepUp()
  @RequirePermissions(PERMISSIONS.SECURITY.PRIVACY_MANAGE)
  eraseCustomer(
    @CurrentUser() user: AuthContext,
    @Param('customerId') customerId: string,
    @Body() dto: EraseCustomerDto,
  ) {
    return this.privacy.erase(
      customerId,
      dto.reason,
      this.who(user),
      resolveTenantFilter(user),
    );
  }

  // ---------------------------------------------------------------- retention (platform)
  @Get('retention')
  @Roles('SUPER_ADMIN')
  @RequirePermissions(PERMISSIONS.SECURITY.RETENTION_MANAGE)
  retentionPreview() {
    return this.retention.preview();
  }

  @Post('retention/run')
  @Roles('SUPER_ADMIN')
  @RequireStepUp()
  @RequirePermissions(PERMISSIONS.SECURITY.RETENTION_MANAGE)
  runRetention(@CurrentUser() user: AuthContext) {
    return this.retention.run(user.sub);
  }

  // ---------------------------------------------------------------- break-glass
  @Get('break-glass')
  @RequirePermissions(PERMISSIONS.SECURITY.VIEW)
  listBreakGlass(@CurrentUser() user: AuthContext) {
    return this.breakGlass.list(resolveTenantFilter(user));
  }

  @Post('break-glass')
  @RequirePermissions(PERMISSIONS.SECURITY.BREAK_GLASS_REQUEST)
  requestBreakGlass(
    @CurrentUser() user: AuthContext,
    @Body() dto: BreakGlassRequestDto,
  ) {
    return this.breakGlass.request(dto, this.who(user));
  }

  @Post('break-glass/:id/approve')
  @Roles('SUPER_ADMIN')
  @RequireStepUp()
  @RequirePermissions(PERMISSIONS.SECURITY.BREAK_GLASS_APPROVE)
  approveBreakGlass(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.breakGlass.approve(id, { identityId: user.sub });
  }

  @Post('break-glass/:id/deny')
  @Roles('SUPER_ADMIN')
  @RequirePermissions(PERMISSIONS.SECURITY.BREAK_GLASS_APPROVE)
  denyBreakGlass(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.breakGlass.deny(id, { identityId: user.sub });
  }

  @Post('break-glass/:id/revoke')
  @RequirePermissions(PERMISSIONS.SECURITY.BREAK_GLASS_REQUEST)
  revokeBreakGlass(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.breakGlass.revoke(id, { identityId: user.sub });
  }
}
