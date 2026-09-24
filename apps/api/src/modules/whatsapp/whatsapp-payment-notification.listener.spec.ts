import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { WhatsAppConversationsService } from './whatsapp-conversations.service';
import { WhatsAppPaymentNotificationListener } from './whatsapp-payment-notification.listener';

describe('WhatsAppPaymentNotificationListener', () => {
  let listener: WhatsAppPaymentNotificationListener;
  let prisma: {
    customer: { findUnique: jest.Mock };
    invoice: { findUnique: jest.Mock };
  };
  let conversationsService: { sendAutomatedMessage: jest.Mock };

  const event = {
    invoiceId: 'invoice-1',
    customerId: 'customer-1',
    amount: 30_000,
    currency: 'NGN',
  };

  beforeEach(async () => {
    prisma = {
      customer: { findUnique: jest.fn() },
      invoice: { findUnique: jest.fn() },
    };
    conversationsService = { sendAutomatedMessage: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppPaymentNotificationListener,
        { provide: PrismaService, useValue: prisma },
        {
          provide: WhatsAppConversationsService,
          useValue: conversationsService,
        },
      ],
    }).compile();

    listener = module.get(WhatsAppPaymentNotificationListener);
  });

  it('does nothing for a customer with no WhatsApp number on file', async () => {
    prisma.customer.findUnique.mockResolvedValue({
      companyId: 'company-a',
      whatsapp: null,
    });

    await listener.handlePaymentSucceeded(event);

    expect(conversationsService.sendAutomatedMessage).not.toHaveBeenCalled();
  });

  it('sends an idempotent confirmation, reusing the standard opt-in-checked send path', async () => {
    prisma.customer.findUnique.mockResolvedValue({
      companyId: 'company-a',
      whatsapp: '+2348012345678',
    });
    prisma.invoice.findUnique.mockResolvedValue({
      invoiceNumber: 'INV-ABCD1234',
    });

    await listener.handlePaymentSucceeded(event);

    expect(conversationsService.sendAutomatedMessage).toHaveBeenCalledWith(
      'company-a',
      '+2348012345678',
      expect.stringContaining('INV-ABCD1234'),
      'payment-confirmed:invoice-1',
      'customer-1',
    );
  });

  it('never throws — a notification failure must never look like a payment problem', async () => {
    prisma.customer.findUnique.mockRejectedValue(new Error('db down'));

    await expect(
      listener.handlePaymentSucceeded(event),
    ).resolves.toBeUndefined();
  });
});
