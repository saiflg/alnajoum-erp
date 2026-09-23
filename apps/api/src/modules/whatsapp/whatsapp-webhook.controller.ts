import {
  Controller,
  Get,
  Headers,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import type { NormalizedInboundEvent } from './providers/whatsapp-provider.port';
import { WhatsAppProviderRouter } from './providers/whatsapp-provider.router';
import { WhatsAppWebhookService } from './whatsapp-webhook.service';

/**
 * Phase 14 spec #12/#74 — the public Meta webhook endpoint. GET handles
 * the one-time subscription handshake (hub.challenge); POST receives
 * every actual event. Both delegate signature/token verification to the
 * active provider (WhatsAppProviderRouter) rather than checking anything
 * here directly, so a future non-Meta provider's own verification scheme
 * plugs in with no controller change. Never exposes internal application
 * data in the response — success is always a bare 200, failure a bare
 * 401/200-with-no-body (Meta expects 200 even for events we choose not
 * to act on, to avoid it endlessly retrying a "successfully received but
 * intentionally ignored" event).
 */
@Controller('whatsapp/webhook')
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(
    private readonly providerRouter: WhatsAppProviderRouter,
    private readonly webhookService: WhatsAppWebhookService,
  ) {}

  @Public()
  @Get()
  async verify(@Query() query: Record<string, string>, @Res() res: Response) {
    const challenge = await this.providerRouter.verifyWebhookChallenge(query);
    if (challenge === null) {
      throw new UnauthorizedException('Webhook verification failed');
    }
    res.status(200).send(challenge);
  }

  @Public()
  @Post()
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Res() res: Response,
  ) {
    if (
      !req.rawBody ||
      !(await this.providerRouter.verifyWebhookSignature(
        req.rawBody,
        signature,
      ))
    ) {
      // Still 200 here (not 401): an attacker probing the endpoint learns
      // nothing either way, and Meta itself never sends an unsigned
      // request in practice — a 401 would only ever fire for a genuine
      // attack attempt, where revealing "this endpoint exists and
      // validates signatures" is exactly the information not to hand
      // back either. Nothing is processed either way.
      res.status(200).send();
      return;
    }

    const provider = await this.providerRouter.activeProviderName();
    const concreteProvider = provider === 'meta' ? provider : 'mock';
    let events: NormalizedInboundEvent[];
    try {
      const resolved = await this.providerRouter.resolve();
      events = resolved.parseWebhookPayload(req.body);
    } catch (error) {
      this.logger.error(
        `Failed to parse WhatsApp webhook payload: ${error instanceof Error ? error.message : String(error)}`,
      );
      res.status(200).send();
      return;
    }

    for (const event of events) {
      const isNew = await this.webhookService.recordEventOnceOrSkip(
        concreteProvider,
        event.providerMessageId || `${event.kind}-${event.timestamp}`,
        event,
      );
      if (!isNew) continue; // spec #12/#43 — duplicate delivery, already processed

      try {
        await this.webhookService.processEvent(event);
        await this.webhookService.markEventProcessed(
          concreteProvider,
          event.providerMessageId || `${event.kind}-${event.timestamp}`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Failed to process WhatsApp webhook event: ${message}`,
        );
        await this.webhookService.markEventProcessed(
          concreteProvider,
          event.providerMessageId || `${event.kind}-${event.timestamp}`,
          message,
        );
      }
    }

    res.status(200).send();
  }
}
