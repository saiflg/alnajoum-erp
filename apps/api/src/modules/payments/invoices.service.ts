import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FlightBooking, InvoiceStatus, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

type PrismaTransactionClient = Prisma.TransactionClient;

function generateInvoiceNumber(): string {
  return `INV-${randomBytes(4).toString('hex').toUpperCase()}`;
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
}
