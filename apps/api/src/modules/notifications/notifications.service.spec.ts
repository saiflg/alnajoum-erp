import { Test, TestingModule } from '@nestjs/testing';
import { NotificationStatus, NotificationType } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import { NOTIFICATION_PROVIDER } from './providers/notification-provider.port';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: { notification: { create: jest.Mock; findMany: jest.Mock } };
  let provider: { sendEmail: jest.Mock };

  beforeEach(async () => {
    prisma = {
      notification: { create: jest.fn(), findMany: jest.fn() },
    };
    provider = { sendEmail: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
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
});
