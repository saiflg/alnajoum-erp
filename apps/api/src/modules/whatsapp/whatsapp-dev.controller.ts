import { Body, Controller, ForbiddenException, Post } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import {
  SimulateInboundDto,
  SimulateStatusDto,
} from './dto/simulate-inbound.dto';
import { MockWhatsAppProviderService } from './providers/mock-whatsapp-provider.service';
import { WhatsAppProviderRouter } from './providers/whatsapp-provider.router';
import { WhatsAppWebhookService } from './whatsapp-webhook.service';

/**
 * Phase 14 spec #69/#122 — the developer WhatsApp simulator. Lets staff
 * (with WHATSAPP.MANAGE) exercise the exact same processing pipeline a
 * real Meta webhook would, without any real credentials or a public
 * webhook URL — the "no real WhatsApp credentials required for local
 * development" requirement in practice. Guarded by checking the WHATSAPP
 * provider is actually "mock" (not just a permission check): once a real
 * Meta provider is activated in a deployment, these endpoints refuse to
 * run rather than letting a fabricated event be injected into a real
 * conversation history — the closest equivalent here to a secure
 * dev-only feature flag, since this codebase's environment strategy is
 * "which provider is active", not a separate NODE_ENV gate (spec #70).
 */
@Controller('whatsapp/dev')
export class WhatsAppDevController {
  constructor(
    private readonly providerRouter: WhatsAppProviderRouter,
    private readonly mockProvider: MockWhatsAppProviderService,
    private readonly webhookService: WhatsAppWebhookService,
  ) {}

  private async assertMockActive(): Promise<void> {
    const active = await this.providerRouter.activeProviderName();
    if (active !== 'mock') {
      throw new ForbiddenException(
        'The WhatsApp dev simulator only works while the Mock provider is active.',
      );
    }
  }

  @Post('simulate-inbound')
  @RequirePermissions(PERMISSIONS.WHATSAPP.MANAGE)
  async simulateInbound(@Body() dto: SimulateInboundDto) {
    await this.assertMockActive();
    const [event] = this.mockProvider.parseWebhookPayload({
      type: 'message',
      from: dto.from,
      text: dto.text,
      interactiveReplyId: dto.interactiveReplyId,
    });
    const isNew = await this.webhookService.recordEventOnceOrSkip(
      'mock',
      event.providerMessageId,
      event,
    );
    if (isNew) {
      await this.webhookService.processEvent(event);
      await this.webhookService.markEventProcessed(
        'mock',
        event.providerMessageId,
      );
    }
    return { simulated: true, event };
  }

  @Post('simulate-status')
  @RequirePermissions(PERMISSIONS.WHATSAPP.MANAGE)
  async simulateStatus(@Body() dto: SimulateStatusDto) {
    await this.assertMockActive();
    const [event] = this.mockProvider.parseWebhookPayload({
      type: 'status',
      providerMessageId: dto.providerMessageId,
      status: dto.status,
      failureReason: dto.failureReason,
    });
    await this.webhookService.processEvent(event);
    return { simulated: true, event };
  }
}
