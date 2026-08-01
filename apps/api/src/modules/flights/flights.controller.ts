import { Controller, Get, Param, Query } from '@nestjs/common';
import { SearchFlightsDto } from './dto/search-flights.dto';
import { FlightsService } from './flights.service';

@Controller('flights')
export class FlightsController {
  constructor(private readonly flightsService: FlightsService) {}

  @Get('search')
  search(@Query() dto: SearchFlightsDto) {
    return this.flightsService.search(dto);
  }

  @Get('offers/:offerId')
  getOffer(@Param('offerId') offerId: string) {
    return this.flightsService.getOffer(offerId);
  }
}
