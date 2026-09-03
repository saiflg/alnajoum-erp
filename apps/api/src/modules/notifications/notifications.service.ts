import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  NotificationChannel,
  NotificationStatus,
  NotificationType,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
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

interface WalletUpdateDetails {
  type: 'DEPOSIT' | 'DEBIT';
  amount: number;
  currency: string;
  description: string;
}

interface InstallmentReminderDetails {
  registrationNumber: string;
  packageName: string;
  totalAmount: number;
  balance: number;
  currency: string;
  overdue: boolean;
}

interface DocumentMissingDetails {
  missingDocumentTypes: string[];
}

interface ManualPaymentStatusDetails {
  invoiceNumber: string;
  amount: number;
  currency: string;
  status: 'APPROVED' | 'REJECTED' | 'CLARIFICATION_REQUESTED';
  reviewNote?: string;
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
    identityId?: string,
  ): Promise<void> {
    try {
      const result = await this.provider.sendEmail({ to, subject, textBody });
      await this.prisma.notification.create({
        data: {
          type,
          channel: NotificationChannel.EMAIL,
          recipient: to,
          subject,
          body: textBody,
          status: result.success
            ? NotificationStatus.SENT
            : NotificationStatus.FAILED,
          errorMessage: result.error,
          identityId,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to send/record ${type} notification: ${message}`,
      );
    }
  }

  /**
   * Same recording contract as `send()`, but over SMS or WhatsApp — used by
   * the two notification types that go out over more than one channel
   * (installment/overdue reminders, document-missing reminders). Silently a
   * no-op when the recipient has no phone number on file; a provider that
   * isn't configured for the channel (see SmtpNotificationProviderService)
   * still records a FAILED row rather than pretending to have sent it.
   */
  private async sendText(
    channel: 'SMS' | 'WHATSAPP',
    type: NotificationType,
    to: string | null | undefined,
    subject: string,
    body: string,
    identityId?: string,
  ): Promise<void> {
    if (!to) return;
    try {
      const result =
        channel === 'SMS'
          ? await this.provider.sendSms({ to, body })
          : await this.provider.sendWhatsApp({ to, body });
      await this.prisma.notification.create({
        data: {
          type,
          channel:
            channel === 'SMS'
              ? NotificationChannel.SMS
              : NotificationChannel.WHATSAPP,
          recipient: to,
          subject,
          body,
          status: result.success
            ? NotificationStatus.SENT
            : NotificationStatus.FAILED,
          errorMessage: result.error,
          identityId,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to send/record ${type} ${channel} notification: ${message}`,
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

  /** Shared by Hajj and Umrah registration confirmations — same shape as a
   * booking confirmation, just for a package instead of a flight. */
  async sendPilgrimageRegistrationConfirmation(
    email: string,
    details: {
      kind: 'Hajj' | 'Umrah';
      registrationNumber: string;
      packageName: string;
      totalAmount: number;
      currency: string;
      pilgrimCount: number;
    },
  ): Promise<void> {
    const subject = `${details.kind} registration confirmed: ${details.registrationNumber}`;
    const body = [
      `Your ${details.kind} registration is confirmed.`,
      '',
      `Registration: ${details.registrationNumber}`,
      `Package: ${details.packageName}`,
      `Pilgrims: ${details.pilgrimCount}`,
      `Total: ${details.currency} ${details.totalAmount}`,
    ].join('\n');
    await this.send(
      NotificationType.BOOKING_CONFIRMATION,
      email,
      subject,
      body,
    );
  }

  async sendWalletUpdate(
    email: string,
    identityId: string,
    update: WalletUpdateDetails,
  ): Promise<void> {
    const verb = update.type === 'DEPOSIT' ? 'credited' : 'debited';
    const subject = `Wallet ${verb}: ${update.currency} ${update.amount}`;
    const body = [
      `Your wallet was ${verb}.`,
      '',
      `Amount: ${update.currency} ${update.amount}`,
      `Description: ${update.description}`,
    ].join('\n');
    await this.send(
      update.type === 'DEPOSIT'
        ? NotificationType.WALLET_DEPOSIT
        : NotificationType.WALLET_DEBIT,
      email,
      subject,
      body,
      identityId,
    );
  }

  /**
   * Multi-channel by design: email always, plus SMS and WhatsApp when a
   * phone/WhatsApp number is on file — reminders are the one notification
   * type explicitly required to reach a customer more than one way (a
   * missed email is exactly the failure mode a payment reminder needs to
   * survive).
   */
  async sendInstallmentReminder(
    email: string,
    identityId: string,
    reminder: InstallmentReminderDetails,
    phone?: string | null,
    whatsapp?: string | null,
  ): Promise<void> {
    const type = reminder.overdue
      ? NotificationType.PAYMENT_OVERDUE
      : NotificationType.INSTALLMENT_REMINDER;
    const subject = reminder.overdue
      ? `Payment overdue: ${reminder.registrationNumber}`
      : `Installment reminder: ${reminder.registrationNumber}`;
    const body = [
      reminder.overdue
        ? 'A payment on your registration is overdue.'
        : "Here's a reminder of your remaining balance.",
      '',
      `Package: ${reminder.packageName}`,
      `Registration: ${reminder.registrationNumber}`,
      `Total: ${reminder.currency} ${reminder.totalAmount}`,
      `Remaining balance: ${reminder.currency} ${reminder.balance}`,
    ].join('\n');
    await Promise.all([
      this.send(type, email, subject, body, identityId),
      this.sendText('SMS', type, phone, subject, body, identityId),
      this.sendText('WHATSAPP', type, whatsapp, subject, body, identityId),
    ]);
  }

  async sendDocumentMissingReminder(
    email: string,
    identityId: string,
    details: DocumentMissingDetails,
    phone?: string | null,
    whatsapp?: string | null,
  ): Promise<void> {
    const subject = 'Missing documents on your profile';
    const body = [
      'The following documents are still missing from your profile:',
      '',
      ...details.missingDocumentTypes.map((type) => `- ${type}`),
      '',
      'Please upload them to avoid delays with your applications.',
    ].join('\n');
    await Promise.all([
      this.send(
        NotificationType.DOCUMENT_MISSING,
        email,
        subject,
        body,
        identityId,
      ),
      this.sendText(
        'SMS',
        NotificationType.DOCUMENT_MISSING,
        phone,
        subject,
        body,
        identityId,
      ),
      this.sendText(
        'WHATSAPP',
        NotificationType.DOCUMENT_MISSING,
        whatsapp,
        subject,
        body,
        identityId,
      ),
    ]);
  }

  async sendManualPaymentStatus(
    email: string,
    identityId: string,
    details: ManualPaymentStatusDetails,
  ): Promise<void> {
    const type =
      details.status === 'APPROVED'
        ? NotificationType.MANUAL_PAYMENT_APPROVED
        : NotificationType.MANUAL_PAYMENT_REJECTED;
    const subject = `Manual payment ${details.status.toLowerCase().replace('_', ' ')}: ${details.invoiceNumber}`;
    const body = [
      `Your submitted payment of ${details.currency} ${details.amount} against invoice ${details.invoiceNumber} was ${details.status.toLowerCase().replace('_', ' ')}.`,
      details.reviewNote ? `\nNote from finance: ${details.reviewNote}` : '',
    ].join('\n');
    await this.send(type, email, subject, body, identityId);
  }

  /**
   * Fans out to every staff identity that can actually review manual
   * payments — this was the one gap where MANUAL_PAYMENT_SUBMITTED existed
   * as a NotificationType but nothing ever fired it, leaving finance staff
   * to notice new submissions only by checking the review queue manually.
   */
  async notifyManualPaymentSubmitted(details: {
    invoiceNumber: string;
    amount: number;
    currency: string;
    method: string;
  }): Promise<void> {
    const reviewers = await this.prisma.identity.findMany({
      where: {
        roles: {
          some: {
            role: {
              permissions: {
                some: {
                  permission: { key: PERMISSIONS.MANUAL_PAYMENT.REVIEW },
                },
              },
            },
          },
        },
      },
      select: { id: true, email: true },
    });

    const subject = `New manual payment awaiting review: ${details.invoiceNumber}`;
    const body = [
      `A ${details.method.toLowerCase().replace('_', ' ')} payment of ${details.currency} ${details.amount} was submitted against invoice ${details.invoiceNumber} and needs your review.`,
      '',
      'Review it from Manual Payments in the admin dashboard.',
    ].join('\n');

    await Promise.all(
      reviewers.map((reviewer) =>
        this.send(
          NotificationType.MANUAL_PAYMENT_SUBMITTED,
          reviewer.email,
          subject,
          body,
          reviewer.id,
        ),
      ),
    );
  }

  /** Fired on every VisaApplication status transition — see VisaService.updateStatus. */
  async sendVisaApplicationStatusUpdate(
    email: string,
    identityId: string,
    details: {
      applicationReference: string;
      destinationCountry: string;
      status: string;
      staffNote?: string | null;
    },
  ): Promise<void> {
    const subject = `Visa application ${details.applicationReference}: ${details.status.replace(/_/g, ' ').toLowerCase()}`;
    const body = [
      `Your visa application to ${details.destinationCountry} (${details.applicationReference}) is now: ${details.status.replace(/_/g, ' ').toLowerCase()}.`,
      details.staffNote
        ? `\nNote from our visa team: ${details.staffNote}`
        : '',
    ].join('\n');
    await this.send(
      NotificationType.VISA_APPLICATION_STATUS_CHANGED,
      email,
      subject,
      body,
      identityId,
    );
  }

  listAll(filters: { type?: NotificationType; status?: NotificationStatus }) {
    return this.prisma.notification.findMany({
      where: filters,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** In-app feed for the calling identity's dashboard widget. */
  listForIdentity(identityId: string) {
    return this.prisma.notification.findMany({
      where: { identityId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async markRead(id: string, identityId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { id, identityId },
      data: { isRead: true },
    });
  }

  async markAllRead(identityId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { identityId, isRead: false },
      data: { isRead: true },
    });
  }
}
