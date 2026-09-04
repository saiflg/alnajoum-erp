import {
  Body,
  Controller,
  Delete,
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
import { CreateHotelRoomTypeDto } from './dto/create-hotel-room-type.dto';
import { CreateHotelDto } from './dto/create-hotel.dto';
import { UpdateHotelRoomTypeDto } from './dto/update-hotel-room-type.dto';
import { UpdateHotelDto } from './dto/update-hotel.dto';
import { HotelCatalogService } from './hotel-catalog.service';

@Controller('hotels/catalog')
@RequirePermissions(PERMISSIONS.HOTEL.MANAGE_CATALOG)
export class HotelCatalogController {
  constructor(private readonly catalogService: HotelCatalogService) {}

  @Get()
  list(@Query('city') city?: string, @Query('status') status?: string) {
    return this.catalogService.listHotels({ city, status });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.catalogService.getHotel(id);
  }

  @Post()
  create(@CurrentUser() user: AuthContext, @Body() dto: CreateHotelDto) {
    return this.catalogService.createHotel(dto, user.sub);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateHotelDto,
  ) {
    return this.catalogService.updateHotel(id, dto, user.sub);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.catalogService.deleteHotel(id, user.sub);
  }

  @Post(':id/room-types')
  createRoomType(
    @CurrentUser() user: AuthContext,
    @Param('id') hotelId: string,
    @Body() dto: CreateHotelRoomTypeDto,
  ) {
    return this.catalogService.createRoomType(hotelId, dto, user.sub);
  }

  @Patch('room-types/:id')
  updateRoomType(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateHotelRoomTypeDto,
  ) {
    return this.catalogService.updateRoomType(id, dto, user.sub);
  }

  @Delete('room-types/:id')
  removeRoomType(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.catalogService.deleteRoomType(id, user.sub);
  }
}
