import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FlightGroupBookingStatus, InvoiceStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreateFlightGroupBookingDto } from './dto/create-flight-group-booking.dto';

function generateGroupReference(): string {
  return `GRP-${randomBytes(4).toString('hex').toUpperCase()}`;
}

/**
 * Internal record-keeping for a negotiated group reservation (spec #17) —
 * see the FlightGroupBooking schema doc comment for why this is staff-
 * managed rather than a live provider order. Deposit/balance tracking is
 * against an Invoice created alongside the group booking, reusing the same
 * Invoice/Payment machinery every other module in this codebase already
 * bills through, rather than a second bespoke ledger.
 */
@Injectable()
export class FlightGroupBookingsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    dto: CreateFlightGroupBookingDto,
    createdByStaffId: string | undefined,
  ) {
    if (dto.deposit > dto.negotiatedPrice) {
      throw new BadRequestException(
        'Deposit cannot exceed the negotiated price',
      );
    }
    const balance = dto.negotiatedPrice - dto.deposit;

    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.create({
        data: {
          invoiceNumber: `INV-${randomBytes(4).toString('hex').toUpperCase()}`,
          status:
            dto.deposit >= dto.negotiatedPrice
              ? InvoiceStatus.PAID
              : InvoiceStatus.ISSUED,
          currency: dto.currency,
          totalAmount: dto.negotiatedPrice,
          issuedByStaffId: createdByStaffId,
          lineItems: {
            create: [
              {
                description: `Group flight booking: ${dto.groupName} (${dto.numberOfPassengers} passengers, ${dto.destination})`,
                amount: dto.negotiatedPrice,
              },
            ],
          },
        },
      });

      const group = await tx.flightGroupBooking.create({
        data: {
          groupReference: generateGroupReference(),
          groupName: dto.groupName,
          groupContactName: dto.groupContactName,
          groupContactPhone: dto.groupContactPhone,
          groupContactEmail: dto.groupContactEmail,
          numberOfPassengers: dto.numberOfPassengers,
          origin: dto.origin,
          destination: dto.destination,
          travelDate: new Date(dto.travelDate),
          airline: dto.airline,
          negotiatedPrice: dto.negotiatedPrice,
          currency: dto.currency,
          deposit: dto.deposit,
          balance,
          status: FlightGroupBookingStatus.CONFIRMED,
          createdByStaffId,
          branchId: dto.branchId,
          invoiceId: invoice.id,
          passengers: dto.passengers
            ? {
                create: dto.passengers.map((p) => ({
                  firstName: p.firstName,
                  lastName: p.lastName,
                  dateOfBirth: p.dateOfBirth ? new Date(p.dateOfBirth) : null,
                  passportNumber: p.passportNumber,
                })),
              }
            : undefined,
        },
        include: { passengers: true, invoice: true },
      });

      return group;
    });
  }

  listAll(filters: { status?: FlightGroupBookingStatus }) {
    return this.prisma.flightGroupBooking.findMany({
      where: filters,
      include: {
        passengers: true,
        invoice: true,
        createdByStaff: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string) {
    const group = await this.prisma.flightGroupBooking.findUnique({
      where: { id },
      include: { passengers: true, invoice: true },
    });
    if (!group) {
      throw new NotFoundException('Group booking not found');
    }
    return group;
  }

  async recordPayment(id: string, amount: number) {
    const group = await this.get(id);
    if (amount <= 0 || amount > group.balance) {
      throw new BadRequestException(
        'Payment amount must be positive and not exceed the outstanding balance',
      );
    }
    const newBalance = group.balance - amount;
    if (newBalance === 0 && group.invoiceId) {
      await this.prisma.invoice.update({
        where: { id: group.invoiceId },
        data: { status: InvoiceStatus.PAID },
      });
    }
    return this.prisma.flightGroupBooking.update({
      where: { id },
      data: { deposit: group.deposit + amount, balance: newBalance },
    });
  }

  async importManifest(
    id: string,
    passengers: Array<{
      firstName: string;
      lastName: string;
      dateOfBirth?: string;
      passportNumber?: string;
    }>,
  ) {
    await this.get(id);
    return this.prisma.$transaction(
      passengers.map((p) =>
        this.prisma.flightGroupPassenger.create({
          data: {
            groupBookingId: id,
            firstName: p.firstName,
            lastName: p.lastName,
            dateOfBirth: p.dateOfBirth ? new Date(p.dateOfBirth) : null,
            passportNumber: p.passportNumber,
          },
        }),
      ),
    );
  }
}
