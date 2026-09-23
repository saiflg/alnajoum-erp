import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WhatsAppConsentService } from './whatsapp-consent.service';

describe('WhatsAppConsentService', () => {
  let service: WhatsAppConsentService;
  let prisma: {
    whatsAppConsent: { findUnique: jest.Mock; upsert: jest.Mock };
    customer: { update: jest.Mock };
  };
  let auditService: { record: jest.Mock };

  beforeEach(async () => {
    prisma = {
      whatsAppConsent: { findUnique: jest.fn(), upsert: jest.fn() },
      customer: { update: jest.fn() },
    };
    auditService = { record: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppConsentService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get(WhatsAppConsentService);
  });

  describe('command detection', () => {
    it.each(['stop', 'STOP', 'Unsubscribe', 'cancel', '  stop  '])(
      'recognizes "%s" as a stop command',
      (text) => {
        expect(WhatsAppConsentService.isStopCommand(text)).toBe(true);
      },
    );

    it('does not treat an unrelated message as a stop command', () => {
      expect(
        WhatsAppConsentService.isStopCommand('please stop delaying my ticket'),
      ).toBe(false);
    });

    it.each(['start', 'START', 'subscribe'])(
      'recognizes "%s" as a start command',
      (text) => {
        expect(WhatsAppConsentService.isStartCommand(text)).toBe(true);
      },
    );
  });

  describe('getStatus', () => {
    it('returns UNKNOWN when no consent row exists yet', async () => {
      prisma.whatsAppConsent.findUnique.mockResolvedValue(null);
      await expect(service.getStatus('+2348031234567')).resolves.toBe(
        'UNKNOWN',
      );
    });

    it('normalizes the phone number before looking it up', async () => {
      prisma.whatsAppConsent.findUnique.mockResolvedValue({
        status: 'OPTED_IN',
      });
      await service.getStatus('08031234567');
      expect(prisma.whatsAppConsent.findUnique).toHaveBeenCalledWith({
        where: { phoneNumber: '+2348031234567' },
      });
    });
  });

  describe('recordConsent', () => {
    it('opts a customer out and updates both the consent row and the customer record', async () => {
      prisma.whatsAppConsent.upsert.mockResolvedValue({ id: 'consent-1' });

      await service.recordConsent(
        '+2348031234567',
        'OPTED_OUT',
        'whatsapp_stop_command',
        'customer-1',
      );

      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'customer-1' },
        data: expect.objectContaining({ whatsappOptIn: false }),
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'whatsapp.consent.opted_out' }),
      );
    });

    it('opts a customer in and updates both rows', async () => {
      prisma.whatsAppConsent.upsert.mockResolvedValue({ id: 'consent-1' });

      await service.recordConsent(
        '+2348031234567',
        'OPTED_IN',
        'customer_portal',
        'customer-1',
      );

      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'customer-1' },
        data: expect.objectContaining({ whatsappOptIn: true }),
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'whatsapp.consent.opted_in' }),
      );
    });

    it('records consent for an unmatched phone number with no customerId, without touching Customer', async () => {
      prisma.whatsAppConsent.upsert.mockResolvedValue({ id: 'consent-1' });

      await service.recordConsent(
        '+2348031234567',
        'OPTED_OUT',
        'whatsapp_stop_command',
      );

      expect(prisma.customer.update).not.toHaveBeenCalled();
      expect(prisma.whatsAppConsent.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { phoneNumber: '+2348031234567' },
        }),
      );
    });
  });
});
