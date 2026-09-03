import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { VisaServiceStatus } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { CreateVisaServiceDto } from './dto/create-visa-service.dto';
import { UpdateVisaServiceDto } from './dto/update-visa-service.dto';
import { VisaServicesService } from './visa-services.service';

/**
 * The visa product catalog — staff-facing (includes cost/margin). The
 * public/customer-facing equivalent is VisaController.listActiveServices()
 * in visa.controller.ts, which strips company cost and margin before
 * responding (customers must never see internal cost or incentive data —
 * see the spec's "CUSTOMER PORTAL" section).
 */
@Controller('visa/services')
export class VisaServicesController {
  constructor(private readonly visaServicesService: VisaServicesService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.VISA.CREATE)
  create(@CurrentUser() user: AuthContext, @Body() dto: CreateVisaServiceDto) {
    return this.visaServicesService.create(dto, user.sub);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.VISA.VIEW)
  list(
    @Query('status') status?: VisaServiceStatus,
    @Query('country') country?: string,
  ) {
    return this.visaServicesService.list({ status, country });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.VISA.VIEW)
  get(@Param('id') id: string) {
    return this.visaServicesService.get(id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.VISA.EDIT)
  update(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateVisaServiceDto,
  ) {
    return this.visaServicesService.update(id, dto, user.sub);
  }
}
