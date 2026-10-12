import { Body, Controller, Get, Param, Post, Put, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { CommPublicService } from './comm-public.service';
import {
  PublicPreferencesDto,
  PublicSubscribeDto,
  PublicUnsubscribeDto,
} from './dto/comm.dto';

/** Subscribing sends a message to whatever address is typed, so it is limited tightly per client. */
const SUBSCRIBE_THROTTLE = { default: { ttl: 60_000, limit: 5 } } as const;
/** Token pages reveal nothing without a valid token, but guessing is still limited. */
const TOKEN_THROTTLE = { default: { ttl: 60_000, limit: 30 } } as const;

/**
 * Public consent routes. Nothing here accepts a staff session and nothing returns a list: each route works on the
 * one thing a token or a submitted form identifies. Confirming and unsubscribing are POSTs on purpose - a mail
 * scanner that opens every link in a message must not be able to confirm or cancel anyone's subscription.
 */
@Controller('public/comm')
export class CommPublicController {
  constructor(private readonly service: CommPublicService) {}

  private info(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  @Public()
  @Throttle(TOKEN_THROTTLE)
  @Get('subscribe-info')
  subscribeInfo() {
    return this.service.info();
  }

  @Public()
  @Throttle(SUBSCRIBE_THROTTLE)
  @Post('subscribe')
  subscribe(@Body() dto: PublicSubscribeDto, @Req() req: Request) {
    return this.service.subscribe(dto, this.info(req));
  }

  @Public()
  @Throttle(TOKEN_THROTTLE)
  @Post('confirm/:token')
  confirm(@Param('token') token: string) {
    return this.service.confirm(token);
  }

  @Public()
  @Throttle(TOKEN_THROTTLE)
  @Get('preferences/:token')
  preferences(@Param('token') token: string) {
    return this.service.preferences(token);
  }

  @Public()
  @Throttle(TOKEN_THROTTLE)
  @Put('preferences/:token')
  updatePreferences(
    @Param('token') token: string,
    @Body() dto: PublicPreferencesDto,
    @Req() req: Request,
  ) {
    return this.service.updatePreferences(token, dto, this.info(req));
  }

  /** Also the RFC 8058 one-click target: a mail client posts here without a body and means "unsubscribe from email". */
  @Public()
  @Throttle(TOKEN_THROTTLE)
  @Post('unsubscribe/:token')
  unsubscribe(
    @Param('token') token: string,
    @Body() dto: PublicUnsubscribeDto,
    @Req() req: Request,
  ) {
    return this.service.unsubscribe(
      token,
      dto?.channel ?? 'EMAIL',
      this.info(req),
    );
  }
}
