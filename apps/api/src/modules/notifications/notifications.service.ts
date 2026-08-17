import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationStatus, NotificationType } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NOTIFICATION_PROVIDER } from './providers/notification-provider.port';
import type { NotificationProviderPort } from './providers/notification-provider.port';

interface BookingConfirmationDetails {
  bookingReference: string;
  origin: string;
  destination: string;
  departureAt: Date;
  totalAmount: number;
  currency: string;
}

interface PaymentReceiptDetails {
  invoiceNumber: string;
  amount: number;
  balance: number;
  currency: string;
}

interface ContactMessageDetails {
  name: string;
  email: string;
  subject: string;
  message: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @Inject(NOTIFICATION_PROVIDER)
    private readonly provider: NotificationProviderPort,
  ) {}

  /**
   * Sends and records the attempt regardless of outcome. Never throws —
   * a notification failure must never block the operation that triggered
   * it (staff creation, a payment, a booking).
   */
  private async send(
    type: NotificationType,
    to: string,
    subject: string,
    textBody: string,
  ): Promise<void> {
    try {
      const result = await this.provider.sendEmail({ to, subject, textBody });
      await this.prisma.notification.create({
        data: {
          type,
          recipient: to,
          subject,
          body: textBody,
          status: result.success
            ? NotificationStatus.SENT
            : NotificationStatus.FAILED,
          errorMessage: result.error,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to send/record ${type} notification: ${message}`,
      );
    }
  }

  async sendStaffTempPassword(
    email: string,
    firstName: string,
    tempPassword: string,
  ): Promise<void> {
    const subject = 'Your Alnajoum Travel Agency staff account';
    const body = [
      `Hi ${firstName},`,
      '',
      'An account has been created for you on the Alnajoum Travel Agency platform.',
      '',
      `Temporary password: ${tempPassword}`,
      '',
      'Please log in and change this password as soon as possible.',
    ].join('\n');
    await this.send(NotificationType.STAFF_TEMP_PASSWORD, email, subject, body);
  }

  async sendBookingConfirmation(
    email: string,
    booking: BookingConfirmationDetails,
  ): Promise<void> {
    const subject = `Booking confirmed: ${booking.bookingReference}`;
    const body = [
      'Your flight booking is confirmed.',
      '',
      `Reference: ${booking.bookingReference}`,
      `Route: ${booking.origin} → ${booking.destination}`,
      `Departure: ${booking.departureAt.toISOString()}`,
      `Total: ${booking.currency} ${booking.totalAmount}`,
    ].join('\n');
    await this.send(
      NotificationType.BOOKING_CONFIRMATION,
      email,
      subject,
      body,
    );
  }

  async sendPaymentReceipt(
    email: string,
    receipt: PaymentReceiptDetails,
  ): Promise<void> {
    const subject = `Payment received: ${receipt.invoiceNumber}`;
    const body = [
      "We've received your payment.",
      '',
      `Invoice: ${receipt.invoiceNumber}`,
      `Amount paid: ${receipt.currency} ${receipt.amount}`,
      `Remaining balance: ${receipt.currency} ${receipt.balance}`,
    ].join('\n');
    await this.send(NotificationType.PAYMENT_RECEIPT, email, subject, body);
  }

  /** Public contact form submission — emails the agency, not the visitor. */
  async sendContactMessage(details: ContactMessageDetails): Promise<void> {
    const recipient = this.configService.get<string>(
      'CONTACT_RECIPIENT_EMAIL',
      'alnajoumtravelagency@gmail.com',
    );
    const subject = `Website contact: ${details.subject}`;
    const body = [
      `From: ${details.name} <${details.email}>`,
      '',
      details.message,
    ].join('\n');
    await this.send(NotificationType.CONTACT_MESSAGE, recipient, subject, body);
  }

  listAll(filters: { type?: NotificationType; status?: NotificationStatus }) {
    return this.prisma.notification.findMany({
      where: filters,
      orderBy: { createdAt: 'desc' },
    });
  }
}
