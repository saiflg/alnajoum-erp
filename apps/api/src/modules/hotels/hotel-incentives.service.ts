import { Injectable } from '@nestjs/common';
import { HotelBooking, IncentiveStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinancePostingService } from '../finance/finance-posting.service';
import { calculateStaffIncentiveAmount } from '../incentives/incentive-calculator';
import { NotificationsService } from '../notifications/notifications.service';

function generateIncentiveReference(): string {
  return `INC-${randomBytes(4).toString('hex').toUpperCase()}`;
}

/**
 * Hotel-side counterpart of FlightIncentivesService/VisaIncentivesService
 * — reuses the exact same calculateStaffIncentiveAmount and StaffIncentive
 * table (spec #17's "use the existing incentive engine rather than
 * creating another"). Called only from HotelCompletionService.complete,
 * once a booking is COMPLETED and paid — never at booking creation.
 */
@Injectable()
export class HotelIncentivesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
    private readonly financePostingService: FinancePostingService,
  ) {}

  async createForCompletedBooking(booking: HotelBooking): Promise<void> {
    const staffId = booking.bookedByStaffId ?? booking.completedByStaffId;
    if (!staffId) return;
    if (booking.supplierCost == null) return;

    const existing = await this.prisma.staffIncentive.findFirst({
      where: { sourceType: 'HOTEL_BOOKING', sourceId: booking.id },
    });
    if (existing) return;

    await this.financePostingService.postCostOfServiceForBooking({
      sourceModule: 'HOTEL_BOOKING',
      sourceId: booking.id,
      supplierName: booking.provider,
      amount: booking.supplierCost,
      currency: booking.currency,
    });

    const policy = await this.prisma.incentivePolicy.findFirst({
      where: { isDefault: true, isActive: true },
    });
    const margin = booking.totalAmount - booking.supplierCost;
    const amount = calculateStaffIncentiveAmount(margin, policy);
    if (amount <= 0) return;

    const incentive = await this.prisma.staffIncentive.create({
      data: {
        staffId,
        sourceType: 'HOTEL_BOOKING',
        sourceId: booking.id,
        amount,
        currency: booking.currency,
        description: `Incentive on hotel booking ${booking.bookingReference}`,
        status: IncentiveStatus.PENDING,
        referenceNumber: generateIncentiveReference(),
        companyCost: booking.supplierCost,
        sellingPrice: booking.totalAmount,
        margin,
        policyId: policy?.id,
        customerId: booking.customerId,
      },
    });

    await this.auditService.record({
      action: 'hotel_incentive.created',
      entityType: 'StaffIncentive',
      entityId: incentive.id,
      metadata: { bookingId: booking.id, staffId, amount, margin },
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
