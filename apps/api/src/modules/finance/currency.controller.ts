import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { CreateCurrencyDto } from './dto/create-currency.dto';
import { UpdateCurrencyDto } from './dto/update-currency.dto';
import { CurrencyService } from './currency.service';

@Controller('currencies')
export class CurrencyController {
  constructor(private readonly service: CurrencyService) {}

  /** Bare @RequirePermissions() — any authenticated identity can read the
   * currency list (e.g. to populate a booking form's currency picker),
   * same "reference data has no read gate" pattern as country visa rules. */
  @Get()
  @RequirePermissions()
  list(@Query('activeOnly') activeOnly?: string) {
    return this.service.listAll(activeOnly === 'true');
  }

  @Get(':code')
  @RequirePermissions()
  get(@Param('code') code: string) {
    return this.service.get(code);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CURRENCY.MANAGE)
  create(@CurrentUser() user: AuthContext, @Body() dto: CreateCurrencyDto) {
    return this.service.create(dto, user.sub);
  }

  @Patch(':code')
  @RequirePermissions(PERMISSIONS.CURRENCY.MANAGE)
  update(
    @CurrentUser() user: AuthContext,
    @Param('code') code: string,
    @Body() dto: UpdateCurrencyDto,
  ) {
    return this.service.update(code, dto, user.sub);
  }
}
