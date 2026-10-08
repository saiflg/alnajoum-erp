import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { PUBLIC_SEARCH_THROTTLE } from '../../common/security/throttle-limits';
import { SearchHotelsDto } from './dto/search-hotels.dto';
import { HotelsService } from './hotels.service';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';

@RequireFeature('ENABLE_HOTELS')
@Controller('hotels')
export class HotelsController {
  constructor(private readonly hotelsService: HotelsService) {}

  @Public()
  @Throttle(PUBLIC_SEARCH_THROTTLE)
  @Post('search')
  search(@Body() dto: SearchHotelsDto) {
    return this.hotelsService.search(dto);
  }

  @Public()
  @Get('offers/:offerId')
  getOffer(@Param('offerId') offerId: string) {
    return this.hotelsService.getOffer(offerId);
  }
}
