import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FlightBookingStatus,
  PassengerType,
  Prisma,
  ProviderOperation,
  ProviderTransactionStatus,
  TripType,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinancePostingService } from '../finance/finance-posting.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InvoicesService } from '../payments/invoices.service';
import { CreateManualFlightBookingDto } from './dto/create-manual-flight-booking.dto';
import { CreatePassengerDto } from './dto/create-passenger.dto';
import { SearchFlightsDto } from './dto/search-flights.dto';
import { FlightIncentivesService } from './flight-incentives.service';
import { FlightPricingService } from './flight-pricing.service';
import { FlightProviderRoutingService } from './flight-provider-routing.service';
import { ProviderTransactionLogService } from './provider-transaction-log.service';
import { FLIGHT_PROVIDER } from './providers/flight-provider.port';
import type {
  BookingPassengerSnapshot,
  FlightOffer,
  FlightProviderPort,
  SearchFlightsCriteria,
} from './providers/flight-provider.port';
import { FlightProviderRouter } from './providers/flight-provider.router';

function generateBookingReference(): string {
  return `ANJ-${randomBytes(4).toString('hex').toUpperCase()}`;
}

export interface RevalidationResult {
  offer: FlightOffer;
  priceChanged: boolean;
  previousAmount: number;
  currentAmount: number;
}

@Injectable()
export class FlightsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(FLIGHT_PROVIDER) private readonly provider: FlightProviderPort,
    private readonly invoicesService: InvoicesService,
    private readonly notificationsService: NotificationsService,
    private readonly pricingService: FlightPricingService,
    private readonly providerLog: ProviderTransactionLogService,
    private readonly providerRoutingService: FlightProviderRoutingService,
    private readonly providerRouter: FlightProviderRouter,
    private readonly auditService: AuditService,
    private readonly flightIncentivesService: FlightIncentivesService,
    private readonly financePostingService: FinancePostingService,
  ) {}

  /**
   * Spec #30/#31 — when an administrator has configured a provider
   * priority for this route (or globally), search tries each provider in
   * order until one succeeds, falling back only on a genuine failure
   * (never on "no results" — an empty result set from the first provider
   * that answers is still a real answer, not tried against the next one).
   * Fallback is search-only: whichever provider's offer the customer
   * actually selects is what createBooking books through, so no fallback
   * here can ever cause a duplicate booking. With no routing rule
   * configured at all, this is byte-for-byte the pre-Phase-10 behavior —
   * search through whichever single provider is currently active.
   */
  async search(dto: SearchFlightsDto): Promise<FlightOffer[]> {
    this.validateLegCount(dto.tripType, dto.legs.length);

    const criteria: SearchFlightsCriteria = {
      tripType: dto.tripType,
      legs: dto.legs,
      adults: dto.adults,
      children: dto.children,
      infants: dto.infants,
      cabinClass: dto.cabinClass,
      directOnly: dto.directOnly,
    };

    const firstLeg = dto.legs[0];
    const providerOrder = await this.providerRoutingService.resolveOrder(
      firstLeg?.origin,
      firstLeg?.destination,
    );

    if (providerOrder.length === 0) {
      return this.searchViaProvider(this.provider, criteria, dto.directOnly);
    }

    let lastError: unknown;
    for (const providerName of providerOrder) {
      try {
        return await this.searchViaProvider(
          this.providerRouter.resolveByName(providerName),
          criteria,
          dto.directOnly,
        );
      } catch (error) {
        lastError = error;
        // Try the next provider in the configured priority order.
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('All configured providers failed to return flight offers');
  }

  private async searchViaProvider(
    provider: FlightProviderPort,
    criteria: SearchFlightsCriteria,
    directOnly?: boolean,
  ): Promise<FlightOffer[]> {
    try {
      const offers = await provider.searchOffers(criteria);
      await this.providerLog.record({
        provider: offers[0]?.provider ?? 'MOCK',
        operation: ProviderOperation.SEARCH,
        status: ProviderTransactionStatus.SUCCESS,
        safeMessage: `${offers.length} offer(s) returned`,
      });
      // Fare conditions/restrictions are shown as-is, never invented — the
      // customer/staff sees exactly what searchOffers's fareConditions
      // carried through from the provider (spec #4/#5).
      return directOnly
        ? offers.filter((o) => o.legs.every((l) => l.segments.length === 1))
        : offers;
    } catch (error) {
      await this.providerLog.record({
        provider: 'MOCK',
        operation: ProviderOperation.SEARCH,
        status: ProviderTransactionStatus.FAILURE,
        safeMessage: error instanceof Error ? error.message : 'Search failed',
      });
      throw error;
    }
  }

  /**
   * Price revalidation (spec #6) — refetches the offer from the provider
   * and reports whether the price moved since the customer last saw it.
   * Never assumes a cached search price is still valid: createBooking below
   * always calls getOffer itself too, so a stale offer can't slip through
   * even if a caller skips this step.
   */
  async revalidate(
    offerId: string,
    previousAmount: number,
  ): Promise<RevalidationResult> {
    const offer = await this.getOffer(offerId);
    return {
      offer,
      priceChanged: offer.totalAmount !== previousAmount,
      previousAmount,
      currentAmount: offer.totalAmount,
    };
  }

  private validateLegCount(tripType: TripType, legCount: number): void {
    if (tripType === TripType.ONE_WAY && legCount !== 1) {
      throw new BadRequestException('A one-way trip must have exactly 1 leg');
    }
    if (tripType === TripType.ROUND_TRIP && legCount !== 2) {
      throw new BadRequestException(
        'A round trip must have exactly 2 legs (outbound and return)',
      );
    }
    if (tripType === TripType.MULTI_CITY && legCount < 2) {
      throw new BadRequestException(
        'A multi-city trip must have at least 2 legs',
      );
    }
  }

  async getOffer(offerId: string): Promise<FlightOffer> {
    const offer = await this.provider.getOffer(offerId);
    if (!offer) {
      throw new NotFoundException(
        'This flight offer has expired or does not exist',
      );
    }
    return offer;
  }

  /**
   * Resolves each passenger input to a name/DOB/passport snapshot, verifying
   * that any referenced family member actually belongs to `customerId`.
   */
  private async resolvePassengerSnapshots(
    customerId: string,
    passengers: CreatePassengerDto[],
  ): Promise<BookingPassengerSnapshot[]> {
    const snapshots: BookingPassengerSnapshot[] = [];

    for (const passenger of passengers) {
      if (passenger.familyMemberId) {
        const member = await this.prisma.familyMember.findUnique({
          where: { id: passenger.familyMemberId },
        });
        if (!member) {
          throw new NotFoundException('Family member not found');
        }
        if (member.customerId !== customerId) {
          throw new ForbiddenException(
            'This family member does not belong to this customer',
          );
        }
        snapshots.push({
          type: passenger.type,
          firstName: member.firstName,
          lastName: member.lastName,
          dateOfBirth: member.dateOfBirth,
          passportNumber: member.passportNumber,
        });
      } else {
        const customer = await this.prisma.customer.findUnique({
          where: { id: customerId },
        });
        if (!customer) {
          throw new NotFoundException('Customer not found');
        }
        snapshots.push({
          type: passenger.type,
          firstName: customer.firstName,
          lastName: customer.lastName,
          dateOfBirth: customer.dateOfBirth,
          passportNumber: customer.passportNumber,
        });
      }
    }

    return snapshots;
  }

  async createBooking(
    customerId: string,
    offerId: string,
    passengerInputs: CreatePassengerDto[],
    bookedByStaffId?: string,
    idempotencyKey?: string,
    expectedPrice?: number,
    options?: { hold?: boolean },
  ) {
    // Duplicate-submission guard (spec #9) — a retried request with the
    // same key returns the booking that already exists instead of booking
    // (and charging) twice.
    if (idempotencyKey) {
      const existing = await this.prisma.flightBooking.findUnique({
        where: { idempotencyKey },
        include: { passengers: true },
      });
      if (existing) {
        return existing;
      }
    }

    // Never assume a cached search price is still valid (spec #6) —
    // getOffer always refetches from the provider, and if the caller told
    // us what price they last agreed to, a mismatch here means the price
    // moved between revalidation and this call; require an explicit
    // resubmission with the new price rather than silently charging more.
    const offer = await this.getOffer(offerId);
    if (expectedPrice !== undefined && offer.totalAmount !== expectedPrice) {
      throw new ConflictException(
        `The price for this flight has changed from ${expectedPrice} to ${offer.totalAmount} ${offer.currency}. Please review and confirm the new price before booking.`,
      );
    }

    const snapshots = await this.resolvePassengerSnapshots(
      customerId,
      passengerInputs,
    );

    if (options?.hold) {
      const capabilities = await this.provider.capabilities();
      if (!capabilities.hold) {
        throw new ConflictException(
          'The active flight provider does not support hold reservations for this offer.',
        );
      }
    }

    const result = options?.hold
      ? await this.provider.createOrder(offer, snapshots, { hold: true })
      : await this.provider.createOrder(offer, snapshots);
    await this.providerLog.record({
      provider: offer.provider,
      operation: ProviderOperation.CREATE_ORDER,
      status:
        result.status === 'CONFIRMED'
          ? ProviderTransactionStatus.SUCCESS
          : ProviderTransactionStatus.FAILURE,
      safeMessage:
        result.status === 'CONFIRMED'
          ? `Order created: ${result.providerOrderId}`
          : (result.errorMessage ?? 'This offer is no longer available'),
    });
    if (result.status === 'FAILED') {
      throw new ConflictException(
        'This offer is no longer available. Please search again.',
      );
    }

    const firstLeg = offer.legs[0];
    const lastLeg = offer.legs[offer.legs.length - 1];
    const firstSegment = firstLeg.segments[0];

    const bookedByStaff = bookedByStaffId
      ? await this.prisma.staff.findUnique({ where: { id: bookedByStaffId } })
      : null;

    // Configurable agency markup (spec #18) — never hard-coded. The
    // provider's own price becomes providerCost; totalAmount below is what
    // the customer actually pays, both snapshotted so a later pricing-rule
    // edit never retroactively changes an already-booked price.
    const pricing = await this.pricingService.priceOffer(offer.totalAmount, {
      airlineCode: firstSegment?.airlineCode,
      origin: firstLeg.origin,
      destination: lastLeg.destination,
      cabinClass: offer.cabinClass,
      staffId: bookedByStaffId,
      branchId: bookedByStaff?.branchId ?? undefined,
    });

    const booking = await this.prisma.$transaction(async (tx) => {
      const created = await tx.flightBooking.create({
        data: {
          bookingReference: generateBookingReference(),
          customerId,
          bookedByStaffId,
          branchId: bookedByStaff?.branchId,
          provider: offer.provider,
          providerOfferId: offer.id,
          providerOrderId: result.providerOrderId,
          status: result.holdExpiresAt
            ? FlightBookingStatus.ON_HOLD
            : FlightBookingStatus.CONFIRMED,
          holdExpiresAt: result.holdExpiresAt
            ? new Date(result.holdExpiresAt)
            : undefined,
          currency: offer.currency,
          totalAmount: pricing.customerPrice,
          providerCost: offer.totalAmount,
          markupAmount: pricing.markupAmount,
          pricingRuleId: pricing.rule?.id,
          idempotencyKey,
          tripType: offer.tripType,
          origin: firstLeg.origin,
          destination: lastLeg.destination,
          departureAt: new Date(firstLeg.departureAt),
          cabinClass: offer.cabinClass,
          itinerary: offer as unknown as Prisma.InputJsonValue,
          providerWarnings: (offer.fareConditions?.warnings ??
            []) as unknown as Prisma.InputJsonValue,
          fareRules: (offer.fareConditions ??
            null) as unknown as Prisma.InputJsonValue,
          refundable:
            offer.fareConditions?.refundable === undefined
              ? null
              : offer.fareConditions.refundable === 'REFUNDABLE',
          baggageAllowance: (offer.fareConditions?.baggageAllowance ??
            null) as unknown as Prisma.InputJsonValue,
          passengers: {
            create: passengerInputs.map((input, index) => ({
              type: snapshots[index].type,
              customerId: input.familyMemberId ? null : customerId,
              familyMemberId: input.familyMemberId ?? null,
              firstName: snapshots[index].firstName,
              lastName: snapshots[index].lastName,
              dateOfBirth: snapshots[index].dateOfBirth,
              passportNumber: snapshots[index].passportNumber,
            })),
          },
        },
        include: { passengers: true },
      });

      await this.invoicesService.createForFlightBooking(created, tx);

      return created;
    });

    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: { identity: { select: { email: true } } },
    });
    if (customer) {
      await this.notificationsService.sendBookingConfirmation(
        customer.identity.email,
        {
          bookingReference: booking.bookingReference,
          origin: booking.origin,
          destination: booking.destination,
          departureAt: booking.departureAt,
          totalAmount: booking.totalAmount,
          currency: booking.currency,
        },
      );
    }

    return booking;
  }

  /**
   * A manual booking has no provider search offer to snapshot, but every
   * admin/customer page that renders a booking (e.g. the admin detail
   * page's `itinerary.legs.map`) assumes the same FlightOffer shape every
   * real booking's `itinerary` column carries — an ad hoc
   * `{ manual: true, ... }` blob crashes those pages. isOfflineEntry/
   * offlineReason on the booking record are the actual "this was manual"
   * signal; the itinerary itself just needs to look like every other one.
   */
  private buildManualItinerary(
    dto: CreateManualFlightBookingDto,
    providerOfferId: string,
    totalAmount: number,
  ): FlightOffer {
    const departureAt = new Date(dto.departureAt).toISOString();
    return {
      id: providerOfferId,
      provider: 'MOCK',
      tripType: TripType.ONE_WAY,
      cabinClass: dto.cabinClass,
      currency: dto.currency ?? 'NGN',
      totalAmount,
      seatsAvailable: 1,
      expiresAt: departureAt,
      legs: [
        {
          origin: dto.origin,
          destination: dto.destination,
          departureAt,
          arrivalAt: departureAt,
          segments: [
            {
              origin: dto.origin,
              destination: dto.destination,
              departureAt,
              arrivalAt: departureAt,
              airline: dto.airline,
              airlineCode: dto.airline.slice(0, 2).toUpperCase(),
              flightNumber: dto.flightNumber ?? 'N/A',
              cabinClass: dto.cabinClass,
              durationMinutes: 0,
            },
          ],
        },
      ],
      fareConditions: {
        refundable: 'UNKNOWN',
        warnings: [
          {
            message:
              'Manually entered offline booking — fare rules were not returned by a live provider.',
            verified: false,
          },
        ],
      },
    };
  }

  /**
   * Phase 10 spec #40 — a manual/offline booking records what actually
   * happened in an offline transaction (a phone call, a walk-in, an
   * airline/agent counter sale) rather than fabricating a provider order —
   * provider is set to MOCK purely as a technical placeholder (FlightBooking.
   * provider is a required field); isOfflineEntry is the real signal every
   * report/UI/audit trail actually keys off, same convention as
   * VisaApplication.isOfflineEntry. Deliberately does NOT call
   * FlightIncentivesService here even when status is TICKETED — spec #40's
   * "manual transactions must require appropriate approval before becoming
   * incentive-eligible" is enforced by approveManualBooking below being the
   * only path that ever creates the incentive for one of these.
   */
  async createManualBooking(
    dto: CreateManualFlightBookingDto,
    staffId: string,
  ) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: dto.customerId },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    const bookedByStaff = await this.prisma.staff.findUnique({
      where: { id: staffId },
    });

    const currency = dto.currency ?? 'NGN';
    const isTicketed = dto.status === 'TICKETED';
    const providerOfferId = `MANUAL-${randomBytes(4).toString('hex').toUpperCase()}`;

    const booking = await this.prisma.$transaction(async (tx) => {
      const created = await tx.flightBooking.create({
        data: {
          bookingReference: generateBookingReference(),
          customerId: dto.customerId,
          bookedByStaffId: staffId,
          branchId: bookedByStaff?.branchId,
          provider: 'MOCK',
          providerOfferId,
          status: isTicketed
            ? FlightBookingStatus.TICKETED
            : FlightBookingStatus.CONFIRMED,
          currency,
          totalAmount: dto.sellingPrice,
          providerCost: dto.companyCost,
          markupAmount: dto.sellingPrice - dto.companyCost,
          tripType: TripType.ONE_WAY,
          origin: dto.origin,
          destination: dto.destination,
          departureAt: new Date(dto.departureAt),
          cabinClass: dto.cabinClass,
          itinerary: this.buildManualItinerary(
            dto,
            providerOfferId,
            dto.sellingPrice,
          ) as unknown as Prisma.InputJsonValue,
          isOfflineEntry: true,
          offlineReason: dto.offlineReason,
          pnr: dto.pnr,
          ticketedAt: isTicketed ? new Date() : undefined,
          ticketedByStaffId: isTicketed ? staffId : undefined,
          passengers: {
            create: dto.passengers.map((p) => ({
              type: PassengerType.ADULT,
              firstName: p.firstName,
              lastName: p.lastName,
              dateOfBirth: p.dateOfBirth ? new Date(p.dateOfBirth) : undefined,
              passportNumber: p.passportNumber,
              ticketNumber: p.ticketNumber,
            })),
          },
        },
        include: { passengers: true },
      });

      await this.invoicesService.createForFlightBooking(created, tx);
      return created;
    });

    if (dto.supplierName) {
      // Recognized as an accounts-payable obligation immediately — same
      // path as FlightIncentivesService.createForTicketedBooking, not a
      // second hand-rolled supplierPayable.create() (a prior version of
      // this method had one, which skipped both the ledger posting and
      // tenant/supplier-link resolution that this shared method does).
      await this.financePostingService.postCostOfServiceForBooking({
        sourceModule: 'FLIGHT_BOOKING',
        sourceId: booking.id,
        supplierName: dto.supplierName,
        amount: dto.companyCost,
        currency,
      });
    }

    await this.auditService.record({
      identityId: undefined,
      action: 'flight_booking.manual_created',
      entityType: 'FlightBooking',
      entityId: booking.id,
      metadata: {
        staffId,
        offlineReason: dto.offlineReason,
        status: dto.status,
      },
    });

    return booking;
  }

  /**
   * The one sanctioned path that makes a manual booking incentive-eligible
   * (spec #40) — gated by PERMISSIONS.FLIGHT.MANUAL_BOOKING_APPROVE at the
   * controller, a different (higher) permission than the plain STAFF-level
   * MANUAL_BOOKING used to create one, so the creator can't self-approve.
   */
  async approveManualBooking(bookingId: string, approvedByStaffId: string) {
    const booking = await this.prisma.flightBooking.findUnique({
      where: { id: bookingId },
    });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }
    if (!booking.isOfflineEntry) {
      throw new BadRequestException('This is not a manual/offline booking.');
    }
    if (booking.status !== FlightBookingStatus.TICKETED) {
      throw new ConflictException(
        'Only a ticketed manual booking can be approved for incentive eligibility.',
      );
    }

    await this.flightIncentivesService.createForTicketedBooking(booking);

    await this.auditService.record({
      identityId: undefined,
      action: 'flight_booking.manual_approved',
      entityType: 'FlightBooking',
      entityId: bookingId,
      metadata: { approvedByStaffId },
    });

    return this.getBooking(bookingId);
  }

  listForCustomer(customerId: string) {
    return this.prisma.flightBooking.findMany({
      where: { customerId },
      include: { passengers: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Phase 11 spec #3/#65 fix — FlightBooking has no companyId column of
   * its own (adding one to every already-tenant-derivable table would be
   * a much larger migration than the isolation fix itself needs), so the
   * tenant filter joins through `customer.companyId` — every booking has
   * a required customerId, and every customer has a required companyId
   * as of this phase, so the join is always resolvable. `tenantCompanyId`
   * is resolveTenantFilter(user): undefined only for SUPER_ADMIN.
   */
  listAll(
    filters: { customerId?: string; status?: FlightBookingStatus },
    tenantCompanyId?: string,
  ) {
    return this.prisma.flightBooking.findMany({
      where: {
        ...filters,
        ...(tenantCompanyId !== undefined && {
          customer: { companyId: tenantCompanyId },
        }),
      },
      include: {
        passengers: true,
        customer: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Fetches a booking, optionally enforcing that it belongs to
   * `ownerCustomerId` (self-service) and/or `tenantCompanyId` (staff —
   * same NotFound-not-Forbidden reasoning as CustomersService.findOne,
   * so a cross-tenant id can't be distinguished from a missing one). */
  async getBooking(
    id: string,
    ownerCustomerId?: string,
    tenantCompanyId?: string,
  ) {
    const booking = await this.prisma.flightBooking.findUnique({
      where: { id },
      include: { passengers: true, customer: { select: { companyId: true } } },
    });
    if (
      !booking ||
      (tenantCompanyId !== undefined &&
        booking.customer.companyId !== tenantCompanyId)
    ) {
      throw new NotFoundException('Booking not found');
    }
    if (ownerCustomerId && booking.customerId !== ownerCustomerId) {
      throw new ForbiddenException(
        'This booking does not belong to this customer',
      );
    }

    // Spec #40 — there's no stored "approved" flag by design (approval IS
    // the act of creating the incentive, see approveManualBooking below);
    // this computed flag just lets the UI know whether the approve action
    // still applies, without the client having to know that convention.
    const awaitingManualApproval =
      booking.isOfflineEntry &&
      booking.status === FlightBookingStatus.TICKETED &&
      (await this.prisma.staffIncentive.findFirst({
        where: { sourceType: 'FLIGHT_BOOKING', sourceId: booking.id },
      })) === null;

    return { ...booking, awaitingManualApproval };
  }

  /**
   * Plain pre-ticket cancellation — once a booking is TICKETED, the spec
   * requires the fuller refund-with-penalty flow instead (see
   * FlightRefundsService), which is the only path that can move a
   * TICKETED booking to REFUNDED. This method stays intentionally simple
   * for the reservation/pre-ticket stage, matching its original behavior.
   */
  async cancelBooking(id: string, ownerCustomerId?: string) {
    const booking = await this.getBooking(id, ownerCustomerId);
    if (booking.status === FlightBookingStatus.CANCELLED) {
      throw new ConflictException('This booking has already been cancelled');
    }
    if (booking.status === FlightBookingStatus.TICKETED) {
      throw new ConflictException(
        'This booking has already been ticketed — use the refund workflow instead of a plain cancellation.',
      );
    }

    if (booking.providerOrderId) {
      await this.provider.cancelOrder(booking.providerOrderId);
      await this.providerLog.record({
        provider: booking.provider,
        operation: ProviderOperation.CANCEL_ORDER,
        bookingId: booking.id,
        status: ProviderTransactionStatus.SUCCESS,
        safeMessage: 'Order cancelled pre-ticket',
      });
    }

    const cancelled = await this.prisma.flightBooking.update({
      where: { id },
      data: { status: FlightBookingStatus.CANCELLED },
      include: { passengers: true },
    });

    await this.invoicesService.voidIfUnpaid(id);

    return cancelled;
  }
}
