import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { StaffCardVerificationService } from './staff-card-verification.service';

/**
 * Public card verification: what a member of the public sees when they scan a card's QR code.
 *
 *  - The code in the URL identifies a card and nothing else. It authenticates no one and authorises nothing: no route
 *    in the application accepts it as a credential, so a copied QR code can only ever show the card's current status.
 *  - Unknown, malformed and not-yet-activated codes all get the same answer, with the same status code.
 *  - Limited per client; every attempt is logged.
 *  - Only a VALID card shows who it belongs to; every other result shows the status alone.
 */
const PUBLIC_VERIFY_THROTTLE = { default: { ttl: 60_000, limit: 30 } } as const;

@Controller('public/staff-cards')
export class StaffCardPublicController {
  constructor(private readonly verification: StaffCardVerificationService) {}

  @Public()
  @Throttle(PUBLIC_VERIFY_THROTTLE)
  @Get(':token')
  verify(@Param('token') token: string, @Req() req: Request) {
    return this.verification.verifyToken(token, {
      method: 'PUBLIC_LINK',
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Public()
  @Throttle(PUBLIC_VERIFY_THROTTLE)
  @Get(':token/photo')
  async photo(
    @Param('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const bytes = await this.verification.photoForToken(token);
    // The same answer whether the card is unknown, not valid, or simply has no photograph.
    if (!bytes) throw new NotFoundException();
    res.set({
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(bytes);
  }
}
