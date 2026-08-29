import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { SearchHotelsDto } from './dto/search-hotels.dto';
import { HotelsService } from './hotels.service';

@Controller('hotels')
export class HotelsController {
  constructor(private readonly hotelsService: HotelsService) {}

  @Post('search')
  search(@Body() dto: SearchHotelsDto) {
    return this.hotelsService.search(dto);
  }

  @Get('offers/:offerId')
  getOffer(@Param('offerId') offerId: string) {
    return this.hotelsService.getOffer(offerId);
  }
}
