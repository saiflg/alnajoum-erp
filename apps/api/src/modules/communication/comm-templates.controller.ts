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
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { CommOutboundService } from './comm-outbound.service';
import { CommSettingsService } from './comm-settings.service';
import { CommTemplatesService } from './comm-templates.service';
import { normaliseEmail, normalisePhone } from './comm-identifiers';
import {
  CreateTemplateDto,
  ListTemplatesQueryDto,
  PreviewTemplateDto,
  TestEmailDto,
  TestWhatsAppDto,
  UpdateTemplateDto,
} from './dto/comm-template.dto';

function companyOf(user: AuthContext): string {
  if (!user.companyId)
    throw new BadRequestException('Your account is not attached to a company.');
  return user.companyId;
}

@Controller('comm')
export class CommTemplatesController {
  constructor(
    private readonly templates: CommTemplatesService,
    private readonly outbound: CommOutboundService,
    private readonly settings: CommSettingsService,
    private readonly prisma: PrismaService,
  ) {}

  // ---------------------------------------------------------------------------------------------- templates

  @Get('templates')
  @RequirePermissions(PERMISSIONS.COMM.CAMPAIGN_READ)
  list(@CurrentUser() user: AuthContext, @Query() q: ListTemplatesQueryDto) {
    return this.templates.list(companyOf(user), {
      channel: q.channel,
      category: q.category,
      includeInactive: q.includeInactive === 'true',
    });
  }

  @Get('templates/:id')
  @RequirePermissions(PERMISSIONS.COMM.CAMPAIGN_READ)
  get(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.templates.get(companyOf(user), id);
  }

  @Post('templates')
  @RequirePermissions(PERMISSIONS.COMM.TEMPLATE_MANAGE)
  create(@CurrentUser() user: AuthContext, @Body() dto: CreateTemplateDto) {
    return this.templates.create(companyOf(user), dto, user.sub);
  }

  @Put('templates/:id')
  @RequirePermissions(PERMISSIONS.COMM.TEMPLATE_MANAGE)
  update(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.templates.update(companyOf(user), id, dto, user.sub);
  }

  @Delete('templates/:id')
  @RequirePermissions(PERMISSIONS.COMM.TEMPLATE_MANAGE)
  remove(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.templates.remove(companyOf(user), id, user.sub);
  }

  @Post('templates/:id/preview')
  @RequirePermissions(PERMISSIONS.COMM.CAMPAIGN_READ)
  preview(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: PreviewTemplateDto,
  ) {
    return this.templates.preview(companyOf(user), id, dto.values ?? {});
  }

  @Post('templates/sync')
  @RequirePermissions(PERMISSIONS.COMM.TEMPLATE_MANAGE)
  sync(@CurrentUser() user: AuthContext) {
    return this.templates.syncWhatsApp(companyOf(user), user.sub);
  }

  @Post('templates/:id/submitted')
  @RequirePermissions(PERMISSIONS.COMM.TEMPLATE_MANAGE)
  submitted(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.templates.markSubmitted(companyOf(user), id, user.sub);
  }

  @Post('templates/:id/simulate-approval')
  @RequirePermissions(PERMISSIONS.COMM.TEMPLATE_MANAGE)
  simulate(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.templates.simulateApproval(companyOf(user), id, user.sub);
  }

  // ---------------------------------------------------------------------------------------------- integration health

  @Get('integrations/health')
  @RequirePermissions(PERMISSIONS.COMM.CAMPAIGN_READ)
  async health() {
    const [email, whatsapp] = await Promise.all([
      this.outbound.emailHealth(),
      this.outbound.whatsappHealth(),
    ]);
    return { email, whatsapp };
  }

  /**
   * Sends one clearly labelled test email, only to the caller's own address or a configured test recipient, so the
   * button cannot be used to send mail to strangers.
   */
  @Post('integrations/test-email')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @RequirePermissions(PERMISSIONS.COMM.SETTINGS_MANAGE)
  async testEmail(@CurrentUser() user: AuthContext, @Body() dto: TestEmailDto) {
    const to = normaliseEmail(dto.to);
    if (!to)
      throw new BadRequestException('That is not a valid email address.');
    const companyId = companyOf(user);
    const s = await this.settings.get(companyId);
    const me = await this.prisma.identity.findUnique({
      where: { id: user.sub },
      select: { email: true },
    });
    const allowed = new Set(
      [
        me?.email?.toLowerCase(),
        ...s.testRecipients.map((x) => x.toLowerCase()),
      ].filter(Boolean),
    );
    if (!allowed.has(to))
      throw new ForbiddenException(
        'A test email can only go to your own address or one of the test recipients in the settings.',
      );
    const r = await this.outbound.sendEmail({
      to,
      subject: `[TEST] Email check from ${s.senderName}`,
      text: `This is a test message from the Communication Centre of ${s.senderName}. It was requested by a signed-in administrator. If you received it, outgoing email works. Nothing else was sent.`,
      html: `<p>This is a <strong>test message</strong> from the Communication Centre of ${s.senderName}.</p><p>It was requested by a signed-in administrator. If you received it, outgoing email works. Nothing else was sent.</p>`,
      replyTo: s.replyTo ?? undefined,
      fromName: s.senderName,
    });
    return {
      sent: r.ok,
      simulated: r.simulated,
      error: r.error,
      note: r.simulated
        ? 'The built-in simulator carried this: it was written to the server log, not delivered.'
        : undefined,
    };
  }

  /** Sends the opt-in confirmation template to a configured test number: shows the WhatsApp channel works end to end. */
  @Post('integrations/test-whatsapp')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @RequirePermissions(PERMISSIONS.COMM.SETTINGS_MANAGE)
  async testWhatsApp(
    @CurrentUser() user: AuthContext,
    @Body() dto: TestWhatsAppDto,
  ) {
    const to = normalisePhone(dto.to);
    if (!to) throw new BadRequestException('That is not a valid phone number.');
    const companyId = companyOf(user);
    const s = await this.settings.get(companyId);
    const allowed = new Set(
      s.testRecipients.map((x) => normalisePhone(x)).filter(Boolean),
    );
    if (!allowed.has(to))
      throw new ForbiddenException(
        'Add this number to the test recipients in the settings first.',
      );
    await this.templates.ensureDefaults(companyId);
    const tpl = await this.prisma.commTemplate.findFirst({
      where: { companyId, key: 'wa_optin_confirm', language: 'en' },
    });
    if (!tpl?.whatsappTemplateName)
      throw new BadRequestException('The confirmation template is missing.');
    const r = await this.outbound.sendWhatsAppTemplate({
      to,
      templateName: tpl.whatsappTemplateName,
      language: 'en',
      variables: ['Tester', s.senderName],
    });
    return {
      sent: r.ok,
      simulated: r.simulated,
      error: r.error,
      note: r.simulated
        ? 'The built-in simulator carried this: it was written to the server log, not delivered.'
        : undefined,
    };
  }
}
