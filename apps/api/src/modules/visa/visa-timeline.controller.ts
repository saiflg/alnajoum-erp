import { Controller, Get, Param } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { VisaTimelineService } from './visa-timeline.service';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';

@RequireFeature('ENABLE_VISA')
@Controller('visa/applications/:id/timeline')
export class VisaTimelineController {
  constructor(private readonly service: VisaTimelineService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.VISA.VIEW)
  getTimeline(@Param('id') id: string) {
    return this.service.getTimeline(id);
  }
}
