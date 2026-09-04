import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { SearchFlightsDto } from './dto/search-flights.dto';
import { FlightsService } from './flights.service';

@Controller('flights')
export class FlightsController {
  constructor(private readonly flightsService: FlightsService) {}

  @Public()
  @Post('search')
  search(@Body() dto: SearchFlightsDto) {
    return this.flightsService.search(dto);
  }

  @Public()
  @Get('offers/:offerId')
  getOffer(@Param('offerId') offerId: string) {
    return this.flightsService.getOffer(offerId);
  }

  /** Price revalidation (spec #6) — call right before booking to confirm
   * the offer's price hasn't moved since the customer last saw it. */
  @Public()
  @Get('offers/:offerId/revalidate')
  revalidate(
    @Param('offerId') offerId: string,
    @Query('previousAmount') previousAmount: string,
  ) {
    return this.flightsService.revalidate(offerId, Number(previousAmount));
  }
}
