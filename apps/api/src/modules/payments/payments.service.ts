import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { InvoicesService } from './invoices.service';

function generatePaymentReference(): string {
  return `PAY-${randomBytes(4).toString('hex').toUpperCase()}`;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoicesService: InvoicesService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async recordPayment(
    invoiceId: string,
    dto: RecordPaymentDto,
    staffId?: string,
  ) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { payments: true },
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    if (invoice.status === InvoiceStatus.VOID) {
      throw new ConflictException(
        'Cannot record a payment against a voided invoice',
      );
    }
    if (invoice.status === InvoiceStatus.PAID) {
      throw new ConflictException('This invoice is already fully paid');
    }

    const totalPaid = invoice.payments.reduce((sum, p) => sum + p.amount, 0);
    const balance = invoice.totalAmount - totalPaid;
    if (dto.amount > balance) {
      throw new BadRequestException(
        `Payment amount (${dto.amount}) exceeds the outstanding balance (${balance})`,
      );
    }

    await this.prisma.payment.create({
      data: {
        paymentReference: generatePaymentReference(),
        invoiceId,
        amount: dto.amount,
        method: dto.method,
        note: dto.note,
        recordedByStaffId: staffId,
      },
    });

    const updatedInvoice =
      await this.invoicesService.recomputeStatus(invoiceId);

    const customer = await this.prisma.customer.findUnique({
      where: { id: invoice.customerId },
      include: { identity: { select: { email: true } } },
    });
    if (customer) {
      const newBalance = invoice.totalAmount - (totalPaid + dto.amount);
      await this.notificationsService.sendPaymentReceipt(
        customer.identity.email,
        {
          invoiceNumber: invoice.invoiceNumber,
          amount: dto.amount,
          balance: newBalance,
          currency: invoice.currency,
        },
      );
    }

    return updatedInvoice;
  }
}
