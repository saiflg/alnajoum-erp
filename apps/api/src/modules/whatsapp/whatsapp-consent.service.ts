import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { normalizePhoneNumber } from './phone-number.util';

export type ConsentStatusValue = 'OPTED_IN' | 'OPTED_OUT' | 'UNKNOWN';

const STOP_WORDS = new Set([
  'stop',
  'unsubscribe',
  'cancel',
  'optout',
  'opt out',
]);
const START_WORDS = new Set(['start', 'subscribe', 'optin', 'opt in']);

/**
 * Phase 14 spec #9 — Meta-policy-level "may we message this number at
 * all", tracked per phone number (not per Customer, since consent can
 * predate any customer match — spec #7's linking flow only happens
 * later). Distinct from NotificationPreferencesService.whatsappEnabled,
 * which assumes consent already exists and only toggles message
 * categories — see WhatsAppConsent's own schema comment.
 */
@Injectable()
export class WhatsAppConsentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  static isStopCommand(text: string): boolean {
    return STOP_WORDS.has(text.trim().toLowerCase());
  }

  static isStartCommand(text: string): boolean {
    return START_WORDS.has(text.trim().toLowerCase());
  }

  async getStatus(phoneNumber: string): Promise<ConsentStatusValue> {
    const normalized = normalizePhoneNumber(phoneNumber);
    const row = await this.prisma.whatsAppConsent.findUnique({
      where: { phoneNumber: normalized },
    });
    return (row?.status as ConsentStatusValue) ?? 'UNKNOWN';
  }

  /** Records consent, upserted by phone number. `customerId` is attached
   * when already known (e.g. recorded from the customer portal); a
   * webhook-driven STOP/START from an unmatched number still records
   * correctly with no customerId. */
  async recordConsent(
    phoneNumber: string,
    status: ConsentStatusValue,
    source: string,
    customerId?: string,
    actorIdentityId?: string,
  ) {
    const normalized = normalizePhoneNumber(phoneNumber);
    const now = new Date();

    const row = await this.prisma.whatsAppConsent.upsert({
      where: { phoneNumber: normalized },
      create: {
        phoneNumber: normalized,
        customerId,
        status,
        source,
        consentedAt: status === 'OPTED_IN' ? now : undefined,
        optedOutAt: status === 'OPTED_OUT' ? now : undefined,
      },
      update: {
        ...(customerId && { customerId }),
        status,
        source,
        ...(status === 'OPTED_IN' && { consentedAt: now, optedOutAt: null }),
        ...(status === 'OPTED_OUT' && { optedOutAt: now }),
      },
    });

    if (customerId) {
      await this.prisma.customer.update({
        where: { id: customerId },
        data:
          status === 'OPTED_IN'
            ? {
                whatsappOptIn: true,
                whatsappOptInAt: now,
                whatsappOptOutAt: null,
              }
            : status === 'OPTED_OUT'
              ? { whatsappOptIn: false, whatsappOptOutAt: now }
              : {},
      });
    }

    await this.auditService.record({
      identityId: actorIdentityId,
      action:
        status === 'OPTED_IN'
          ? 'whatsapp.consent.opted_in'
          : status === 'OPTED_OUT'
            ? 'whatsapp.consent.opted_out'
            : 'whatsapp.consent.recorded',
      entityType: 'WhatsAppConsent',
      entityId: row.id,
      metadata: { phoneNumber: normalized, source },
    });

    return row;
  }
}
