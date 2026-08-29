import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import {
  NotificationChannel,
  NotificationStatus,
  NotificationType,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import { NOTIFICATION_PROVIDER } from './providers/notification-provider.port';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: {
    notification: { create: jest.Mock; findMany: jest.Mock };
    identity: { findMany: jest.Mock };
  };
  let provider: { sendEmail: jest.Mock; sendSms: jest.Mock; sendWhatsApp: jest.Mock };
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    prisma = {
      notification: { create: jest.fn(), findMany: jest.fn() },
      identity: { findMany: jest.fn() },
    };
    provider = {
      sendEmail: jest.fn(),
      sendSms: jest.fn(),
      sendWhatsApp: jest.fn(),
    };
    configService = {
      get: jest.fn((_key: string, fallback?: unknown) => fallback),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: configService },
        { provide: NOTIFICATION_PROVIDER, useValue: provider },
      ],
    }).compile();

    service = module.get(NotificationsService);
  });

  it('records a SENT notification when the provider succeeds', async () => {
    provider.sendEmail.mockResolvedValue({ success: true });

    await service.sendStaffTempPassword('staff@example.com', 'Fola', 'Tmp123!');

    expect(provider.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'staff@example.com',
        subject: expect.stringContaining('staff account'),
        textBody: expect.stringContaining('Tmp123!'),
      }),
    );
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: NotificationType.STAFF_TEMP_PASSWORD,
          recipient: 'staff@example.com',
          status: NotificationStatus.SENT,
        }),
      }),
    );
  });

  it('records a FAILED notification with the provider error when sending fails', async () => {
    provider.sendEmail.mockResolvedValue({
      success: false,
      error: 'SMTP timeout',
    });

    await service.sendPaymentReceipt('customer@example.com', {
      invoiceNumber: 'INV-ABCD1234',
      amount: 20_000,
      balance: 0,
      currency: 'NGN',
    });

    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: NotificationType.PAYMENT_RECEIPT,
          status: NotificationStatus.FAILED,
          errorMessage: 'SMTP timeout',
        }),
      }),
    );
  });

  it('never throws even if the provider itself throws', async () => {
    provider.sendEmail.mockRejectedValue(new Error('network down'));

    await expect(
      service.sendBookingConfirmation('customer@example.com', {
        bookingReference: 'ANJ-ABCD1234',
        origin: 'LOS',
        destination: 'ABV',
        departureAt: new Date('2027-01-10T08:00:00.000Z'),
        totalAmount: 50_000,
        currency: 'NGN',
      }),
    ).resolves.toBeUndefined();
  });

  it('renders the booking confirmation with route and total', async () => {
    provider.sendEmail.mockResolvedValue({ success: true });

    await service.sendBookingConfirmation('customer@example.com', {
      bookingReference: 'ANJ-ABCD1234',
      origin: 'LOS',
      destination: 'ABV',
      departureAt: new Date('2027-01-10T08:00:00.000Z'),
      totalAmount: 50_000,
      currency: 'NGN',
    });

    expect(provider.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining('ANJ-ABCD1234'),
        textBody: expect.stringContaining('LOS → ABV'),
      }),
    );
  });

  it('lists notifications with optional filters', async () => {
    prisma.notification.findMany.mockResolvedValue([]);

    await service.listAll({ status: NotificationStatus.FAILED });

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: NotificationStatus.FAILED },
      }),
    );
  });

  it('sends a contact message to the configured agency inbox, not the visitor', async () => {
    configService.get.mockReturnValue('contact-inbox@example.com');
    provider.sendEmail.mockResolvedValue({ success: true });

    await service.sendContactMessage({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      subject: 'Hajj package pricing',
      message: 'How much for a family of four?',
    });

    expect(provider.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'contact-inbox@example.com',
        subject: expect.stringContaining('Hajj package pricing'),
        textBody: expect.stringContaining('ada@example.com'),
      }),
    );
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: NotificationType.CONTACT_MESSAGE,
          recipient: 'contact-inbox@example.com',
        }),
      }),
    );
  });

  describe('sendInstallmentReminder', () => {
    const reminder = {
      registrationNumber: 'HAJJ-ABC123',
      packageName: 'Standard Hajj 2027',
      totalAmount: 6_000_000,
      balance: 3_000_000,
      currency: 'NGN',
      overdue: false,
    };

    it('sends over email only when no phone/whatsapp number is on file', async () => {
      provider.sendEmail.mockResolvedValue({ success: true });

      await service.sendInstallmentReminder(
        'amina@example.com',
        'identity-1',
        reminder,
      );

      expect(provider.sendEmail).toHaveBeenCalled();
      expect(provider.sendSms).not.toHaveBeenCalled();
      expect(provider.sendWhatsApp).not.toHaveBeenCalled();
      expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    });

    it('also sends SMS and WhatsApp when both numbers are on file, each recorded with its own channel', async () => {
      provider.sendEmail.mockResolvedValue({ success: true });
      provider.sendSms.mockResolvedValue({ success: true });
      provider.sendWhatsApp.mockResolvedValue({ success: true });

      await service.sendInstallmentReminder(
        'amina@example.com',
        'identity-1',
        reminder,
        '+2348000000101',
        '+2348000000101',
      );

      expect(provider.sendSms).toHaveBeenCalledWith(
        expect.objectContaining({ to: '+2348000000101' }),
      );
      expect(provider.sendWhatsApp).toHaveBeenCalledWith(
        expect.objectContaining({ to: '+2348000000101' }),
      );
      expect(prisma.notification.create).toHaveBeenCalledTimes(3);
      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ channel: NotificationChannel.SMS }),
        }),
      );
      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ channel: NotificationChannel.WHATSAPP }),
        }),
      );
    });

    it('records a FAILED row for a channel the provider reports as not configured, without throwing', async () => {
      provider.sendEmail.mockResolvedValue({ success: true });
      provider.sendSms.mockResolvedValue({
        success: false,
        error: 'SMS is not configured for this deployment',
      });

      await expect(
        service.sendInstallmentReminder(
          'amina@example.com',
          'identity-1',
          reminder,
          '+2348000000101',
          undefined,
        ),
      ).resolves.toBeUndefined();

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            channel: NotificationChannel.SMS,
            status: NotificationStatus.FAILED,
            errorMessage: 'SMS is not configured for this deployment',
          }),
        }),
      );
    });
  });

  describe('notifyManualPaymentSubmitted', () => {
    it('emails every identity holding manual_payment:review, not just one', async () => {
      prisma.identity.findMany.mockResolvedValue([
        { id: 'staff-finance-1', email: 'finance@alnajoum.travel' },
        { id: 'staff-admin-1', email: 'admin@alnajoum.travel' },
      ]);
      provider.sendEmail.mockResolvedValue({ success: true });

      await service.notifyManualPaymentSubmitted({
        invoiceNumber: 'INV-ABC123',
        amount: 20_000,
        currency: 'NGN',
        method: 'BANK_TRANSFER',
      });

      expect(prisma.identity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            roles: expect.objectContaining({
              some: expect.objectContaining({
                role: expect.objectContaining({
                  permissions: expect.objectContaining({
                    some: expect.objectContaining({
                      permission: expect.objectContaining({
                        key: 'manual_payment:review',
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      );
      expect(provider.sendEmail).toHaveBeenCalledTimes(2);
      expect(provider.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'finance@alnajoum.travel' }),
      );
      expect(provider.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'admin@alnajoum.travel' }),
      );
      expect(prisma.notification.create).toHaveBeenCalledTimes(2);
    });

    it('does nothing (no crash) when no staff currently hold the review permission', async () => {
      prisma.identity.findMany.mockResolvedValue([]);

      await service.notifyManualPaymentSubmitted({
        invoiceNumber: 'INV-ABC123',
        amount: 20_000,
        currency: 'NGN',
        method: 'CASH',
      });

      expect(provider.sendEmail).not.toHaveBeenCalled();
    });
  });
});
