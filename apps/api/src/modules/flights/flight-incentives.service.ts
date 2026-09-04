import { Injectable } from '@nestjs/common';
import {
  FlightBooking,
  IncentivePolicy,
  IncentiveStatus,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { calculateStaffIncentiveAmount } from '../incentives/incentive-calculator';
import { NotificationsService } from '../notifications/notifications.service';

function generateIncentiveReference(): string {
  return `INC-${randomBytes(4).toString('hex').toUpperCase()}`;
}

/**
 * Flight-side counterpart of VisaIncentivesService.createForCompletedApplication
 * — deliberately reuses the exact same calculateStaffIncentiveAmount pure
 * function and the exact same StaffIncentive/IncentivePolicy tables (see
 * the spec's "do not duplicate incentive logic inside the flight module").
 * The existing visa-incentives/staff-payouts admin endpoints already list
 * and approve every StaffIncentive regardless of sourceType, so a flight
 * incentive shows up there too — one shared approval/payout engine, not a
 * second one.
 *
 * Called once a booking reaches TICKETED (see FlightTicketingService) —
 * spec #20's "do not credit staff incentives simply because a booking was
 * created" is enforced by calling this only from the ticketing step, never
 * from createBooking.
 */
@Injectable()
export class FlightIncentivesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private async resolvePolicy(
    booking: FlightBooking,
  ): Promise<IncentivePolicy | null> {
    if (booking.pricingRuleId) {
      const rule = await this.prisma.flightPricingRule.findUnique({
        where: { id: booking.pricingRuleId },
        include: { incentivePolicy: true },
      });
      if (rule?.incentivePolicy?.isActive) {
        return rule.incentivePolicy;
      }
    }
    return this.prisma.incentivePolicy.findFirst({
      where: { isDefault: true, isActive: true },
    });
  }

  async createForTicketedBooking(booking: FlightBooking): Promise<void> {
    const staffId = booking.bookedByStaffId ?? booking.ticketedByStaffId;
    if (!staffId) {
      return; // Self-service booking with no staff involved — nobody to credit.
    }
    if (booking.providerCost == null) {
      return; // No costing snapshot to compute a margin from.
    }

    const existing = await this.prisma.staffIncentive.findFirst({
      where: { sourceType: 'FLIGHT_BOOKING', sourceId: booking.id },
    });
    if (existing) {
      return; // Idempotent — a booking can only be ticketed once.
    }

    const margin = booking.totalAmount - booking.providerCost;
    const policy = await this.resolvePolicy(booking);
    const amount = calculateStaffIncentiveAmount(margin, policy);
    if (amount <= 0) {
      return;
    }

    const incentive = await this.prisma.staffIncentive.create({
      data: {
        staffId,
        sourceType: 'FLIGHT_BOOKING',
        sourceId: booking.id,
        amount,
        currency: booking.currency,
        description: `Incentive on flight booking ${booking.bookingReference}`,
        status: IncentiveStatus.PENDING,
        referenceNumber: generateIncentiveReference(),
        companyCost: booking.providerCost,
        sellingPrice: booking.totalAmount,
        margin,
        policyId: policy?.id,
        customerId: booking.customerId,
      },
    });

    await this.auditService.record({
      action: 'flight_incentive.created',
      entityType: 'StaffIncentive',
      entityId: incentive.id,
      metadata: {
        bookingId: booking.id,
        staffId,
        amount,
        margin,
        policyType: policy?.type ?? null,
      },
    });

    const staff = await this.prisma.staff.findUnique({
      where: { id: staffId },
      include: { identity: { select: { id: true, email: true } } },
    });
    if (staff) {
      await this.notificationsService.sendIncentiveUpdate(
        staff.identity.email,
        staff.identity.id,
        {
          referenceNumber: incentive.referenceNumber ?? incentive.id,
          amount,
          currency: incentive.currency,
          status: 'GENERATED',
        },
      );
    }
  }
}
