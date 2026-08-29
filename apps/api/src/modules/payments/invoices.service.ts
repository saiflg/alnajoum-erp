import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FlightBooking,
  HajjRegistration,
  HajjRegistrationPilgrim,
  HotelBooking,
  InvoiceStatus,
  Prisma,
  UmrahRegistration,
  UmrahRegistrationPilgrim,
  VehicleRental,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

type PrismaTransactionClient = Prisma.TransactionClient;

function generateInvoiceNumber(): string {
  return `INV-${randomBytes(4).toString('hex').toUpperCase()}`;
}

/**
 * Splits a total into one whole-unit amount per pilgrim, remainder rounded
 * into the last share so the parts always sum back to exactly `total` —
 * the same "no fractional currency, no drift" constraint every amount in
 * this codebase already follows (see FlightBooking.totalAmount's comment).
 */
function splitEvenly(total: number, count: number): number[] {
  const base = Math.floor(total / count);
  const shares = new Array(count).fill(base);
  shares[count - 1] += total - base * count;
  return shares;
}

@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Called from FlightsService.createBooking inside the same transaction as the booking insert. */
  createForFlightBooking(booking: FlightBooking, tx: PrismaTransactionClient) {
    return tx.invoice.create({
      data: {
        invoiceNumber: generateInvoiceNumber(),
        customerId: booking.customerId,
        flightBookingId: booking.id,
        status: InvoiceStatus.ISSUED,
        currency: booking.currency,
        totalAmount: booking.totalAmount,
        issuedByStaffId: booking.bookedByStaffId,
        lineItems: {
          create: [
            {
              description: `Flight ${booking.bookingReference}: ${booking.origin} → ${booking.destination}`,
              amount: booking.totalAmount,
            },
          ],
        },
      },
    });
  }

  /** Called from HotelsService.createBooking inside the same transaction as the booking insert. */
  createForHotelBooking(booking: HotelBooking, tx: PrismaTransactionClient) {
    return tx.invoice.create({
      data: {
        invoiceNumber: generateInvoiceNumber(),
        customerId: booking.customerId,
        hotelBookingId: booking.id,
        status: InvoiceStatus.ISSUED,
        currency: booking.currency,
        totalAmount: booking.totalAmount,
        issuedByStaffId: booking.bookedByStaffId,
        lineItems: {
          create: [
            {
              description: `${booking.hotelName}, ${booking.city} (${booking.bookingReference}) — ${booking.rooms} room(s), ${booking.checkInDate.toISOString().slice(0, 10)} to ${booking.checkOutDate.toISOString().slice(0, 10)}`,
              amount: booking.totalAmount,
            },
          ],
        },
      },
    });
  }

  /** Called from VehicleRentalsService.createBooking inside the same transaction as the booking insert. */
  createForVehicleRental(rental: VehicleRental, tx: PrismaTransactionClient) {
    return tx.invoice.create({
      data: {
        invoiceNumber: generateInvoiceNumber(),
        customerId: rental.customerId,
        vehicleRentalId: rental.id,
        status: InvoiceStatus.ISSUED,
        currency: rental.currency,
        totalAmount: rental.totalAmount,
        issuedByStaffId: rental.bookedByStaffId,
        lineItems: {
          create: [
            {
              description: `${rental.vehicleName} rental (${rental.bookingReference}) — ${rental.pickupCity}, ${rental.pickupAt.toISOString().slice(0, 10)} to ${rental.dropoffAt.toISOString().slice(0, 10)}`,
              amount: rental.totalAmount,
            },
          ],
        },
      },
    });
  }

  /**
   * Called from HajjService.register inside the same transaction as the
   * registration insert. One combined invoice/payment ledger per
   * registration (family payment, individual payment, and paying from a
   * shared wallet all work against it already) — but the line items are
   * per pilgrim, one row each for their even share of the total, so a
   * family registration's invoice reads as "who owes what" rather than
   * one opaque lump sum. That per-pilgrim breakdown is what "separate
   * payment schedules" means in practice here: nothing stops the family
   * head from paying one pilgrim's share today and another's next month,
   * each payment just isn't tied to a specific line item in the ledger.
   */
  createForHajjRegistration(
    registration: HajjRegistration & { package: { name: string } },
    pilgrims: HajjRegistrationPilgrim[],
    tx: PrismaTransactionClient,
  ) {
    const shares = splitEvenly(registration.totalAmount, pilgrims.length);
    return tx.invoice.create({
      data: {
        invoiceNumber: generateInvoiceNumber(),
        customerId: registration.customerId,
        hajjRegistrationId: registration.id,
        status: InvoiceStatus.ISSUED,
        currency: registration.currency,
        totalAmount: registration.totalAmount,
        issuedByStaffId: registration.registeredByStaffId,
        lineItems: {
          create: pilgrims.map((pilgrim, i) => ({
            description: `Hajj package ${registration.package.name} (${registration.registrationNumber}) — ${pilgrim.firstName} ${pilgrim.lastName}`,
            amount: shares[i],
          })),
        },
      },
    });
  }

  /** Same per-pilgrim line-item breakdown as createForHajjRegistration, for Umrah. */
  createForUmrahRegistration(
    registration: UmrahRegistration & { package: { name: string } },
    pilgrims: UmrahRegistrationPilgrim[],
    tx: PrismaTransactionClient,
  ) {
    const shares = splitEvenly(registration.totalAmount, pilgrims.length);
    return tx.invoice.create({
      data: {
        invoiceNumber: generateInvoiceNumber(),
        customerId: registration.customerId,
        umrahRegistrationId: registration.id,
        status: InvoiceStatus.ISSUED,
        currency: registration.currency,
        totalAmount: registration.totalAmount,
        issuedByStaffId: registration.registeredByStaffId,
        lineItems: {
          create: pilgrims.map((pilgrim, i) => ({
            description: `Umrah package ${registration.package.name} (${registration.registrationNumber}) — ${pilgrim.firstName} ${pilgrim.lastName}`,
            amount: shares[i],
          })),
        },
      },
    });
  }

  listForCustomer(customerId: string) {
    return this.prisma.invoice.findMany({
      where: { customerId },
      include: { lineItems: true, payments: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  listAll(filters: { customerId?: string; status?: InvoiceStatus }) {
    return this.prisma.invoice.findMany({
      where: filters,
      include: {
        lineItems: true,
        payments: true,
        customer: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getInvoice(id: string, ownerCustomerId?: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: { lineItems: true, payments: true },
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    if (ownerCustomerId && invoice.customerId !== ownerCustomerId) {
      throw new ForbiddenException(
        'This invoice does not belong to this customer',
      );
    }
    return invoice;
  }

  /** Recomputes ISSUED/PARTIALLY_PAID/PAID from recorded payments; never touches a VOID invoice. */
  async recomputeStatus(invoiceId: string) {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: { payments: true },
    });
    if (invoice.status === InvoiceStatus.VOID) {
      return invoice;
    }

    const totalPaid = invoice.payments.reduce((sum, p) => sum + p.amount, 0);
    const status =
      totalPaid <= 0
        ? InvoiceStatus.ISSUED
        : totalPaid >= invoice.totalAmount
          ? InvoiceStatus.PAID
          : InvoiceStatus.PARTIALLY_PAID;

    return this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { status },
      include: { lineItems: true, payments: true },
    });
  }

  /**
   * Voids the invoice tied to a flight booking once it's cancelled — but only
   * if nothing has been paid against it yet. An invoice with payments already
   * recorded needs a manual refund/reconciliation step, not an automatic void.
   */
  async voidIfUnpaid(flightBookingId: string): Promise<void> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { flightBookingId },
      include: { payments: true },
    });
    if (!invoice || invoice.payments.length > 0) {
      return;
    }
    await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: InvoiceStatus.VOID },
    });
  }

  /** Same as voidIfUnpaid, for a cancelled hotel booking. */
  async voidHotelBookingIfUnpaid(hotelBookingId: string): Promise<void> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { hotelBookingId },
      include: { payments: true },
    });
    if (!invoice || invoice.payments.length > 0) {
      return;
    }
    await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: InvoiceStatus.VOID },
    });
  }

  /** Same as voidIfUnpaid, for a cancelled vehicle rental. */
  async voidVehicleRentalIfUnpaid(vehicleRentalId: string): Promise<void> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { vehicleRentalId },
      include: { payments: true },
    });
    if (!invoice || invoice.payments.length > 0) {
      return;
    }
    await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: InvoiceStatus.VOID },
    });
  }
}
