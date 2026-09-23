import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { FlightsService } from '../flights/flights.service';

export interface SelfServiceReply {
  text: string;
  /** True when the reply required a verified customer match and none
   * exists yet — WhatsAppWebhookService uses this to kick off the OTP
   * linking flow instead of sending the reply as-is. */
  requiresVerification?: boolean;
}

const WELCOME_MENU = `Welcome to Alnajoum Travel Agency ✈️

How can we help you?

1. My Bookings
2. Talk to Staff
3. Help

Reply with a number, or just tell us what you need.`;

const HELP_TEXT = `You can ask things like:
- "my booking" or "my PNR" — see your flight booking status
- "agent" — talk to a staff member
- "menu" — see this menu again`;

/**
 * Phase 14 spec #14/#16 — the WhatsApp customer self-service surface.
 * Deliberately scoped to the menu + read-only booking lookup for this
 * increment (see WhatsAppModule's own doc comment for what's deferred —
 * flight search/booking, visa/Hajj/Umrah self-service, payment links).
 * Every booking fact comes straight from FlightsService — this service
 * never re-derives or guesses a booking's status/fare/route itself
 * (spec #18's "never invent restrictions/rules" applies just as much to
 * inventing booking facts).
 */
@Injectable()
export class WhatsAppSelfServiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly flightsService: FlightsService,
  ) {}

  welcomeMenu(): string {
    return WELCOME_MENU;
  }

  help(): string {
    return HELP_TEXT;
  }

  /** True when this text plausibly requests something that needs a
   * verified customer identity (booking/payment/document lookups) —
   * used by the webhook processor to decide whether to gate on OTP
   * verification before answering. */
  static requiresVerification(text: string): boolean {
    const q = text.toLowerCase();
    return (
      q.includes('booking') ||
      q.includes('pnr') ||
      q.includes('ticket') ||
      q.includes('flight') ||
      q === '1'
    );
  }

  static requestsAgent(text: string): boolean {
    const q = text.trim().toLowerCase();
    return ['agent', 'staff', 'human', 'talk to someone', '2'].includes(q);
  }

  static requestsMenu(text: string): boolean {
    return ['menu', 'start', 'hi', 'hello'].includes(text.trim().toLowerCase());
  }

  static requestsHelp(text: string): boolean {
    return ['help', '3'].includes(text.trim().toLowerCase());
  }

  /** Formats the customer's most recent bookings — same data
   * FlightsService.listForCustomer already returns for the customer
   * portal, just rendered as WhatsApp text instead of a page. */
  async myBookings(customerId: string): Promise<string> {
    const bookings = await this.flightsService.listForCustomer(customerId);
    if (bookings.length === 0) {
      return "You don't have any flight bookings yet.";
    }
    const recent = bookings.slice(0, 3);
    return recent
      .map(
        (b) =>
          `Booking: ${b.bookingReference}\n` +
          `Route: ${b.origin} → ${b.destination}\n` +
          `Departure: ${b.departureAt.toISOString().slice(0, 10)}\n` +
          `Status: ${b.status}`,
      )
      .join('\n\n');
  }

  /** Resolves the verified Customer for a phone number, or null. Used
   * both to decide whether a message can be answered directly and to
   * fetch the data itself. */
  async findVerifiedCustomer(phoneNumber: string) {
    return this.prisma.customer.findFirst({
      where: { whatsapp: phoneNumber, whatsappVerifiedAt: { not: null } },
    });
  }
}
