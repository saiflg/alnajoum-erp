import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { resolveTenantFilter } from '../../common/utils/tenant.util';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { CommConsentService } from './comm-consent.service';
import { CommContactsService } from './comm-contacts.service';
import { CommSettingsService } from './comm-settings.service';
import {
  CreateContactDto,
  ImportContactsDto,
  LiftSuppressionDto,
  ListContactsQueryDto,
  ListSuppressionQueryDto,
  MergeContactsDto,
  RecordConsentDto,
  SuppressAddressDto,
  UpdateCommSettingsDto,
  UpdateContactDto,
} from './dto/comm.dto';

function companyOf(user: AuthContext): string {
  if (!user.companyId)
    throw new BadRequestException('Your account is not attached to a company.');
  return user.companyId;
}

/** Contacts, consent and the suppression list. Every route is scoped to the caller's company. */
@Controller('comm')
export class CommContactsController {
  constructor(
    private readonly contacts: CommContactsService,
    private readonly consent: CommConsentService,
    private readonly settings: CommSettingsService,
  ) {}

  // ---------------------------------------------------------------------------------------------- contacts

  @Get('contacts')
  @RequirePermissions(PERMISSIONS.COMM.CONTACT_READ)
  list(@CurrentUser() user: AuthContext, @Query() q: ListContactsQueryDto) {
    return this.contacts.list(resolveTenantFilter(user), q);
  }

  @Get('contacts/duplicates')
  @RequirePermissions(PERMISSIONS.COMM.CONTACT_MERGE)
  duplicates(@CurrentUser() user: AuthContext) {
    return this.contacts.findDuplicates(companyOf(user));
  }

  @Get('contacts/export')
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  @RequirePermissions(PERMISSIONS.COMM.CONTACT_EXPORT)
  async export(
    @CurrentUser() user: AuthContext,
    @Query() q: ListContactsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const csv = await this.contacts.exportCsv(companyOf(user), q, {
      identityId: user.sub,
    });
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="contacts.csv"',
      'Cache-Control': 'no-store',
    });
    // A stream, so the response is the file itself and not the JSON envelope every other route returns.
    return new StreamableFile(Buffer.from(csv, 'utf8'));
  }

  @Get('contacts/:id')
  @RequirePermissions(PERMISSIONS.COMM.CONTACT_READ)
  get(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.contacts.get(resolveTenantFilter(user), id);
  }

  @Post('contacts')
  @RequirePermissions(PERMISSIONS.COMM.CONTACT_MANAGE)
  create(@CurrentUser() user: AuthContext, @Body() dto: CreateContactDto) {
    return this.contacts.create(companyOf(user), dto, { identityId: user.sub });
  }

  @Put('contacts/:id')
  @RequirePermissions(PERMISSIONS.COMM.CONTACT_MANAGE)
  update(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateContactDto,
  ) {
    return this.contacts.update(companyOf(user), id, dto, {
      identityId: user.sub,
    });
  }

  @Post('contacts/merge')
  @RequirePermissions(PERMISSIONS.COMM.CONTACT_MERGE)
  merge(@CurrentUser() user: AuthContext, @Body() dto: MergeContactsDto) {
    return this.contacts.merge(companyOf(user), dto.survivorId, dto.mergeIds, {
      identityId: user.sub,
    });
  }

  @Post('contacts/import')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @RequirePermissions(PERMISSIONS.COMM.CONTACT_IMPORT)
  import(@CurrentUser() user: AuthContext, @Body() dto: ImportContactsDto) {
    return this.contacts.importCsv(
      companyOf(user),
      dto.csv,
      { dryRun: dto.dryRun !== false, source: dto.source },
      { identityId: user.sub },
    );
  }

  // ---------------------------------------------------------------------------------------------- consent per contact

  @Get('contacts/:id/consent')
  @RequirePermissions(PERMISSIONS.COMM.CONTACT_READ)
  consentHistory(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.consent.history(resolveTenantFilter(user), id);
  }

  /**
   * An administrator records consent the person gave outside the website (a signed form, a recorded call, in person),
   * or records a withdrawal they were told about. A grant must say what the evidence is.
   */
  @Post('contacts/:id/consent')
  @RequirePermissions(PERMISSIONS.COMM.CONSENT_MANAGE)
  async recordConsent(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: RecordConsentDto,
  ) {
    if (dto.action === 'GRANTED' && !dto.evidence)
      throw new BadRequestException(
        'Say how the person gave consent (signed form, recorded call, in person...).',
      );
    const companyId = companyOf(user);
    const s = await this.settings.get(companyId);
    const r = await this.consent.record({
      companyId,
      contactId: id,
      channel: dto.channel,
      action: dto.action,
      topics: dto.topics,
      source: 'ADMIN',
      text:
        dto.channel === 'EMAIL' ? s.consentTextEmail : s.consentTextWhatsApp,
      textVersion: s.consentTextVersion,
      evidence: { kind: dto.evidence, note: dto.note },
      actorIdentityId: user.sub,
      // The administrator holds the evidence; the person does not also have to click a link.
      doubleOptIn: false,
    });
    return { status: r.status, allowsMarketing: r.allowsMarketing };
  }

  @Get('contacts/:id/export')
  @RequirePermissions(PERMISSIONS.COMM.CONTACT_EXPORT)
  dsrExport(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.contacts.dataSubjectExport(companyOf(user), id, {
      identityId: user.sub,
    });
  }

  @Delete('contacts/:id')
  @RequirePermissions(PERMISSIONS.COMM.CONTACT_MERGE)
  erase(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.contacts.erase(companyOf(user), id, { identityId: user.sub });
  }

  // ---------------------------------------------------------------------------------------------- suppression

  @Get('suppressions')
  @RequirePermissions(PERMISSIONS.COMM.CONTACT_READ)
  suppressions(
    @CurrentUser() user: AuthContext,
    @Query() q: ListSuppressionQueryDto,
  ) {
    return this.consent.listSuppressions(resolveTenantFilter(user), {
      channel: q.channel,
      reason: q.reason,
      includeLifted: q.includeLifted === 'true',
      page: q.page,
      pageSize: q.pageSize,
    });
  }

  @Post('suppressions')
  @RequirePermissions(PERMISSIONS.COMM.SUPPRESSION_MANAGE)
  async suppress(
    @CurrentUser() user: AuthContext,
    @Body() dto: SuppressAddressDto,
  ) {
    await this.consent.suppressAddress({
      companyId: companyOf(user),
      channel: dto.channel,
      value: dto.value,
      reason: 'ADMIN',
      source: 'ADMIN',
      actorIdentityId: user.sub,
    });
    return { suppressed: true };
  }

  @Post('suppressions/:id/lift')
  @RequirePermissions(PERMISSIONS.COMM.SUPPRESSION_MANAGE)
  async lift(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: LiftSuppressionDto,
  ) {
    await this.consent.lift(companyOf(user), id, dto.reason, user.sub);
    return { lifted: true };
  }

  // ---------------------------------------------------------------------------------------------- settings

  @Get('settings')
  @RequirePermissions(PERMISSIONS.COMM.CONTACT_READ)
  async getSettings(@CurrentUser() user: AuthContext) {
    const s = await this.settings.get(companyOf(user));
    return { ...s, topics: this.settings.topics(s) };
  }

  @Put('settings')
  @RequirePermissions(PERMISSIONS.COMM.SETTINGS_MANAGE)
  async updateSettings(
    @CurrentUser() user: AuthContext,
    @Body() dto: UpdateCommSettingsDto,
  ) {
    const s = await this.settings.update(companyOf(user), dto, user.sub);
    return { ...s, topics: this.settings.topics(s) };
  }
}
