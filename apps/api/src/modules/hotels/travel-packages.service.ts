import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus, TravelPackageCategory } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { calculateStaffIncentiveAmount } from '../incentives/incentive-calculator';
import { CreateTravelPackageDto } from './dto/create-travel-package.dto';

function generatePackageReference(): string {
  return `PKG-${randomBytes(4).toString('hex').toUpperCase()}`;
}

/**
 * Package builder (spec #11-#14): staff compose a bundle of priced
 * components — each optionally linking back to a real FlightBooking/
 * HotelBooking/VisaApplication row when one already exists, or standing
 * alone as a priced line item (e.g. "Ziyarat tour", "Airport transfer")
 * when it doesn't. totalCost/totalPrice/margin are simple sums of the
 * components' own cost/price — never a second, independent pricing
 * calculation — and the staff incentive reuses calculateStaffIncentiveAmount
 * exactly like every other module (spec #11's "use the existing incentive
 * engine rather than creating another incentive calculation system").
 */
@Injectable()
export class TravelPackagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    dto: CreateTravelPackageDto,
    createdByStaffId: string | undefined,
  ) {
    if (dto.components.length === 0) {
      throw new BadRequestException(
        'A package must have at least one component',
      );
    }
    const totalCost = dto.components.reduce((s, c) => s + c.cost, 0);
    const totalPrice = dto.components.reduce((s, c) => s + c.price, 0);

    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.create({
        data: {
          invoiceNumber: `INV-${randomBytes(4).toString('hex').toUpperCase()}`,
          customerId: dto.customerId,
          status: InvoiceStatus.ISSUED,
          currency: dto.currency ?? 'NGN',
          totalAmount: totalPrice,
          issuedByStaffId: createdByStaffId,
          lineItems: {
            create: dto.components.map((c) => ({
              description: c.description,
              amount: c.price,
            })),
          },
        },
      });

      const pkg = await tx.travelPackage.create({
        data: {
          packageReference: generatePackageReference(),
          name: dto.name,
          category: dto.category ?? TravelPackageCategory.STANDARD,
          description: dto.description,
          customerId: dto.customerId,
          hajjPackageId: dto.hajjPackageId,
          umrahPackageId: dto.umrahPackageId,
          totalCost,
          totalPrice,
          currency: dto.currency ?? 'NGN',
          createdByStaffId,
          branchId: dto.branchId,
          invoiceId: invoice.id,
          isOfflineEntry: dto.isOfflineEntry ?? false,
          offlineReason: dto.offlineReason,
          components: {
            create: dto.components.map((c) => ({
              type: c.type,
              description: c.description,
              cost: c.cost,
              price: c.price,
              flightBookingId: c.flightBookingId,
              hotelBookingId: c.hotelBookingId,
              visaApplicationId: c.visaApplicationId,
            })),
          },
        },
        include: { components: true, invoice: true },
      });

      await this.auditService.record({
        action: 'travel_package.created',
        entityType: 'TravelPackage',
        entityId: pkg.id,
        metadata: {
          totalCost,
          totalPrice,
          componentCount: dto.components.length,
          offline: dto.isOfflineEntry ?? false,
        },
      });

      return pkg;
    });
  }

  listAll() {
    return this.prisma.travelPackage.findMany({
      include: {
        components: true,
        customer: { select: { firstName: true, lastName: true } },
        invoice: { select: { status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string) {
    const pkg = await this.prisma.travelPackage.findUnique({
      where: { id },
      include: { components: true, invoice: true, customer: true },
    });
    if (!pkg) {
      throw new NotFoundException('Package not found');
    }
    return pkg;
  }

  /** Staff incentive on a package's margin — fires once its invoice is
   * paid, mirroring the "payment confirmed" gate every other incentive
   * source uses. Requires explicit staff confirmation, same reasoning as
   * HotelCompletionService/FlightTicketingService. */
  async confirmAndPayIncentive(id: string, staffId: string) {
    const pkg = await this.get(id);
    if (!pkg.createdByStaffId) return null;
    if (!pkg.invoice || pkg.invoice.status !== InvoiceStatus.PAID) {
      throw new BadRequestException(
        'This package has not been fully paid yet.',
      );
    }

    const existing = await this.prisma.staffIncentive.findFirst({
      where: { sourceType: 'TRAVEL_PACKAGE', sourceId: pkg.id },
    });
    if (existing) return existing;

    const policy = await this.prisma.incentivePolicy.findFirst({
      where: { isDefault: true, isActive: true },
    });
    const margin = pkg.totalPrice - pkg.totalCost;
    const amount = calculateStaffIncentiveAmount(margin, policy);
    if (amount <= 0) return null;

    const incentive = await this.prisma.staffIncentive.create({
      data: {
        staffId: pkg.createdByStaffId,
        sourceType: 'TRAVEL_PACKAGE',
        sourceId: pkg.id,
        amount,
        currency: pkg.currency,
        description: `Incentive on travel package ${pkg.packageReference}`,
        status: 'PENDING',
        referenceNumber: `INC-${randomBytes(4).toString('hex').toUpperCase()}`,
        companyCost: pkg.totalCost,
        sellingPrice: pkg.totalPrice,
        margin,
        policyId: policy?.id,
        customerId: pkg.customerId,
      },
    });
    await this.auditService.record({
      identityId: staffId,
      action: 'travel_package_incentive.created',
      entityType: 'StaffIncentive',
      entityId: incentive.id,
      metadata: { packageId: pkg.id, amount, margin },
    });
    return incentive;
  }
}
