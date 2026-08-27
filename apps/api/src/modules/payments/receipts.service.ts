import { Injectable, NotFoundException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * Renders a single Payment as a branded PDF receipt, streamed straight from
 * pdfkit (no intermediate file) — the controller pipes the returned stream
 * directly into the HTTP response.
 */
@Injectable()
export class ReceiptsService {
  constructor(private readonly prisma: PrismaService) {}

  async renderPaymentReceipt(paymentId: string, ownerCustomerId?: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        invoice: {
          include: {
            customer: true,
            payments: true,
            flightBooking: true,
            hajjRegistration: { include: { package: true } },
            umrahRegistration: { include: { package: true } },
          },
        },
        recordedByStaff: { include: { branch: true } },
      },
    });
    if (!payment) {
      throw new NotFoundException('Payment not found');
    }
    if (ownerCustomerId && payment.invoice.customerId !== ownerCustomerId) {
      throw new NotFoundException('Payment not found');
    }

    const invoice = payment.invoice;
    const totalPaid = invoice.payments.reduce((sum, p) => sum + p.amount, 0);
    const balance = invoice.totalAmount - totalPaid;

    const serviceLabel = invoice.flightBooking
      ? `Flight ${invoice.flightBooking.bookingReference}: ${invoice.flightBooking.origin} → ${invoice.flightBooking.destination}`
      : invoice.hajjRegistration
        ? `Hajj — ${invoice.hajjRegistration.package.name} (${invoice.hajjRegistration.registrationNumber})`
        : invoice.umrahRegistration
          ? `Umrah — ${invoice.umrahRegistration.package.name} (${invoice.umrahRegistration.registrationNumber})`
          : invoice.invoiceNumber;

    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc
      .fontSize(20)
      .fillColor('#0f172a')
      .text('Alnajoum Travel Agency', { align: 'left' })
      .fontSize(10)
      .fillColor('#475569')
      .text('Kankia Street, Unguwar Sarki, Kaduna, Kaduna State, Nigeria')
      .text('alnajoumtravelagency@gmail.com · +2348141906416')
      .moveDown(1.5);

    doc
      .fontSize(16)
      .fillColor('#0f172a')
      .text('Payment Receipt', { align: 'left' })
      .moveDown(0.5);

    const row = (label: string, value: string) => {
      doc
        .fontSize(10)
        .fillColor('#475569')
        .text(label, { continued: true, width: 200 })
        .fillColor('#0f172a')
        .text(value);
    };

    row('Receipt reference:', payment.paymentReference);
    row('Payment date:', payment.paidAt.toISOString().slice(0, 10));
    row(
      'Customer:',
      `${invoice.customer.firstName} ${invoice.customer.lastName}`,
    );
    row('Invoice number:', invoice.invoiceNumber);
    row('Service:', serviceLabel);
    row('Payment method:', payment.method);
    if (payment.recordedByStaff) {
      row(
        'Handled by:',
        `${payment.recordedByStaff.firstName} ${payment.recordedByStaff.lastName}${payment.recordedByStaff.branch ? ` (${payment.recordedByStaff.branch.name})` : ''}`,
      );
    }
    doc.moveDown(1);

    doc
      .fontSize(12)
      .fillColor('#0f172a')
      .text(`Amount paid: ${invoice.currency} ${payment.amount.toLocaleString()}`)
      .fontSize(10)
      .fillColor('#475569')
      .text(`Invoice total: ${invoice.currency} ${invoice.totalAmount.toLocaleString()}`)
      .text(`Remaining balance: ${invoice.currency} ${balance.toLocaleString()}`)
      .moveDown(2);

    doc
      .fontSize(8)
      .fillColor('#94a3b8')
      .text(
        'This is a system-generated receipt from the Alnajoum Travel Agency platform.',
        { align: 'left' },
      );

    doc.end();
    return { stream: doc, filename: `${payment.paymentReference}.pdf` };
  }
}
