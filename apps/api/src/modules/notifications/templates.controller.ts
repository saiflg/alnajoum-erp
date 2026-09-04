import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { TemplatesService } from './templates.service';

/** Spec #16/#22 — administrators editing message templates. */
@Controller('notifications/templates')
@RequirePermissions(PERMISSIONS.INTEGRATIONS.MANAGE)
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Get()
  listAll() {
    return this.templatesService.listAll();
  }

  @Get(':key')
  get(@Param('key') key: string) {
    return this.templatesService.get(key);
  }

  @Patch(':key')
  update(
    @Param('key') key: string,
    @Body()
    body: {
      name?: string;
      subject?: string;
      body?: string;
      isActive?: boolean;
    },
  ) {
    return this.templatesService.update(key, body);
  }
}
