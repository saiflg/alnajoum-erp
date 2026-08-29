import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { SearchVehicleRentalsDto } from './dto/search-vehicle-rentals.dto';
import { VehicleRentalsService } from './vehicle-rentals.service';

@Controller('vehicle-rentals')
export class VehicleRentalsController {
  constructor(private readonly vehicleRentalsService: VehicleRentalsService) {}

  @Post('search')
  search(@Body() dto: SearchVehicleRentalsDto) {
    return this.vehicleRentalsService.search(dto);
  }

  @Get('offers/:offerId')
  getOffer(@Param('offerId') offerId: string) {
    return this.vehicleRentalsService.getOffer(offerId);
  }
}
