import { Test, TestingModule } from '@nestjs/testing';
import { NotificationChannel, NotificationType } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationPreferencesService } from './notification-preferences.service';

describe('NotificationPreferencesService', () => {
  let service: NotificationPreferencesService;
  let prisma: {
    notificationPreference: { findUnique: jest.Mock; upsert: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      notificationPreference: { findUnique: jest.fn(), upsert: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationPreferencesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(NotificationPreferencesService);
  });

  it('defaults every channel to enabled when no preference row exists yet', async () => {
    prisma.notificationPreference.findUnique.mockResolvedValue(null);
    const prefs = await service.get('identity-1');
    expect(prefs).toMatchObject({
      emailEnabled: true,
      smsEnabled: true,
      whatsappEnabled: true,
      inAppEnabled: true,
    });
  });

  it('spec #19: a mandatory notification type is always allowed regardless of the stored preference', async () => {
    prisma.notificationPreference.findUnique.mockResolvedValue({
      identityId: 'identity-1',
      emailEnabled: false,
      smsEnabled: false,
      whatsappEnabled: false,
      inAppEnabled: false,
    });

    const allowed = await service.isAllowed(
      'identity-1',
      NotificationType.PAYMENT_RECEIPT,
      NotificationChannel.EMAIL,
    );

    expect(allowed).toBe(true);
  });

  it('spec #18/#19: an opted-out channel blocks a non-mandatory notification type', async () => {
    prisma.notificationPreference.findUnique.mockResolvedValue({
      identityId: 'identity-1',
      emailEnabled: false,
      smsEnabled: true,
      whatsappEnabled: true,
      inAppEnabled: true,
    });

    const allowed = await service.isAllowed(
      'identity-1',
      NotificationType.WALLET_DEPOSIT,
      NotificationChannel.EMAIL,
    );

    expect(allowed).toBe(false);
  });

  it('allows a non-mandatory type on a channel the identity has not disabled', async () => {
    prisma.notificationPreference.findUnique.mockResolvedValue({
      identityId: 'identity-1',
      emailEnabled: false,
      smsEnabled: true,
      whatsappEnabled: true,
      inAppEnabled: true,
    });

    const allowed = await service.isAllowed(
      'identity-1',
      NotificationType.WALLET_DEPOSIT,
      NotificationChannel.SMS,
    );

    expect(allowed).toBe(true);
  });
});
