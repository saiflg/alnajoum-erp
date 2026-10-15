import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CommDeliveryService } from './comm-delivery.service';
import { CommDeliveryEventType } from '@prisma/client';

interface GenericEvent {
  id?: unknown;
  type?: unknown;
  messageId?: unknown;
  timestamp?: unknown;
  reason?: unknown;
  bounceType?: unknown;
}

const TYPE: Record<string, CommDeliveryEventType> = {
  delivered: 'DELIVERED',
  bounce: 'BOUNCED',
  complaint: 'COMPLAINT',
  click: 'CLICKED',
  unsubscribe: 'UNSUBSCRIBED',
};

/**
 * Where an email provider reports what happened to a message (delivered, bounced, reported as spam, clicked).
 *
 * This accepts one simple, signed JSON format - `{ "events": [{ id, type, messageId, timestamp, reason, bounceType }] }`
 * with an `x-comm-signature: sha256=<hex HMAC of the raw body>` header made with COMM_EMAIL_WEBHOOK_SECRET. Real
 * providers (SES via SNS, SendGrid, Mailgun ...) each use their own format and signing; connecting one means writing
 * a small adapter that produces this shape. Until a secret is set the endpoint refuses everything. Opens are never
 * recorded: this system does not track them.
 */
@Controller('public/comm/webhooks')
export class CommEmailWebhookController {
  private readonly logger = new Logger(CommEmailWebhookController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly delivery: CommDeliveryService,
  ) {}

  @Public()
  @Post('email')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 300 } })
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-comm-signature') signature: string | undefined,
  ) {
    const secret = this.config.get<string>('COMM_EMAIL_WEBHOOK_SECRET');
    if (!secret)
      throw new ServiceUnavailableException(
        'Email delivery reports are not configured.',
      );
    if (!req.rawBody || !signature) throw new UnauthorizedException();
    const expected = Buffer.from(
      createHmac('sha256', secret).update(req.rawBody).digest('hex'),
      'utf8',
    );
    const given = Buffer.from(signature.replace(/^sha256=/i, ''), 'utf8');
    if (given.length !== expected.length || !timingSafeEqual(given, expected))
      throw new UnauthorizedException();

    const body = req.body as { events?: GenericEvent[] } | undefined;
    if (!body || !Array.isArray(body.events) || body.events.length > 500)
      throw new BadRequestException(
        'Expected { events: [...] } with at most 500 events.',
      );
    let applied = 0;
    let ignored = 0;
    for (const ev of body.events) {
      const type = typeof ev.type === 'string' ? TYPE[ev.type] : undefined;
      if (
        !type ||
        typeof ev.messageId !== 'string' ||
        typeof ev.id !== 'string'
      ) {
        ignored++;
        continue;
      }
      const payloadHash = createHash('sha256')
        .update(JSON.stringify(ev))
        .digest('hex');
      try {
        await this.prisma.commWebhookEvent.create({
          data: {
            provider: 'generic-email',
            eventId: ev.id,
            payloadHash,
            status: 'PROCESSED',
            processedAt: new Date(),
          },
        });
      } catch {
        ignored++; // an event we have already taken
        continue;
      }
      const when =
        typeof ev.timestamp === 'string' ? new Date(ev.timestamp) : new Date();
      const outcome = await this.delivery.apply({
        channel: 'EMAIL',
        providerMessageId: ev.messageId,
        type,
        occurredAt: Number.isNaN(when.getTime()) ? new Date() : when,
        providerEventId: ev.id,
        detail: typeof ev.reason === 'string' ? ev.reason : undefined,
        simulated: false,
        hardBounce: ev.bounceType === 'soft' ? false : true,
      });
      if (outcome === 'APPLIED') applied++;
      else ignored++;
    }
    this.logger.log(
      `Email delivery report: ${applied} applied, ${ignored} ignored`,
    );
    return { received: body.events.length, applied, ignored };
  }
}
