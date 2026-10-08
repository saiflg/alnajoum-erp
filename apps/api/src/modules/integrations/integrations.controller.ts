import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  ParseEnumPipe,
} from '@nestjs/common';
import { IntegrationCategory } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UpsertCredentialDto } from './dto/upsert-credential.dto';
import { IntegrationsService } from './integrations.service';

import { RequireStepUp } from '../../common/security/step-up';
/**
 * Integration credentials are PLATFORM settings (one payment key, one email account, one AI key for
 * every tenant). A tenant admin who could edit them could redirect all email, forge payment webhooks
 * or point the AI client at an internal address, so the whole controller is SUPER_ADMIN only.
 */
@Controller('integrations')
@Roles('SUPER_ADMIN')
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Get(':category')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS.READ)
  list(
    @Param('category', new ParseEnumPipe(IntegrationCategory))
    category: IntegrationCategory,
  ) {
    return this.integrationsService.listForCategory(category);
  }

  @RequireStepUp()
  @Patch(':category/:provider')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS.MANAGE)
  async upsertCredential(
    @Param('category', new ParseEnumPipe(IntegrationCategory))
    category: IntegrationCategory,
    @Param('provider') provider: string,
    @Body() dto: UpsertCredentialDto,
    @CurrentUser() user: AuthContext,
  ) {
    await this.integrationsService.upsertCredential(
      category,
      provider,
      dto.config ?? {},
      user.sub,
    );
    return { saved: true };
  }

  @RequireStepUp()
  @Patch(':category/:provider/activate')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS.MANAGE)
  async activate(
    @Param('category', new ParseEnumPipe(IntegrationCategory))
    category: IntegrationCategory,
    @Param('provider') provider: string,
    @CurrentUser() user: AuthContext,
  ) {
    await this.integrationsService.setActive(category, provider, user.sub);
    return { activated: true };
  }
}
