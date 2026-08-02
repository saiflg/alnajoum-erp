import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { SearchFlightsDto } from './dto/search-flights.dto';
import { FlightsService } from './flights.service';

@Controller('flights')
export class FlightsController {
  constructor(private readonly flightsService: FlightsService) {}

  @Post('search')
  search(@Body() dto: SearchFlightsDto) {
    return this.flightsService.search(dto);
  }

  @Get('offers/:offerId')
  getOffer(@Param('offerId') offerId: string) {
    return this.flightsService.getOffer(offerId);
  }
}
