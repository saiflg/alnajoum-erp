import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { InvoiceStatus } from '@prisma/client';
import { FlightsService } from '../flights/flights.service';
import { InvoicesService } from '../payments/invoices.service';
import { PaymentsService } from '../payments/payments.service';
import { WhatsAppConversationsService } from './whatsapp-conversations.service';
import { WhatsAppPaymentLinkService } from './whatsapp-payment-link.service';

describe('WhatsAppPaymentLinkService', () => {
  let service: WhatsAppPaymentLinkService;
  let flightsService: { listForCustomer: jest.Mock };
  let invoicesService: {
    getInvoice: jest.Mock;
    getInvoiceForFlightBooking: jest.Mock;
  };
  let paymentsService: { initiateCheckout: jest.Mock };
  let conversationsService: { get: jest.Mock; sendReply: jest.Mock };

  const unpaidInvoice = {
    id: 'invoice-1',
    invoiceNumber: 'INV-ABCD1234',
    status: InvoiceStatus.ISSUED,
    totalAmount: 150_000,
    currency: 'NGN',
    payments: [],
  };

  beforeEach(async () => {
    flightsService = { listForCustomer: jest.fn() };
    invoicesService = {
      getInvoice: jest.fn(),
      getInvoiceForFlightBooking: jest.fn(),
    };
    paymentsService = { initiateCheckout: jest.fn() };
    conversationsService = { get: jest.fn(), sendReply: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppPaymentLinkService,
        { provide: FlightsService, useValue: flightsService },
        { provide: InvoicesService, useValue: invoicesService },
        { provide: PaymentsService, useValue: paymentsService },
        {
          provide: WhatsAppConversationsService,
          useValue: conversationsService,
        },
      ],
    }).compile();

    service = module.get(WhatsAppPaymentLinkService);
  });

  describe('requestLinkForBooking', () => {
    it("tells the customer plainly when the reference doesn't match any of their own bookings — never guesses", async () => {
      flightsService.listForCustomer.mockResolvedValue([
        { id: 'booking-1', bookingReference: 'AJ-000111' },
      ]);

      const result = await service.requestLinkForBooking(
        'customer-1',
        'AJ-999999',
      );

      expect(result).toContain("couldn't find a booking");
      expect(invoicesService.getInvoiceForFlightBooking).not.toHaveBeenCalled();
    });

    it('matches the booking reference case-insensitively', async () => {
      flightsService.listForCustomer.mockResolvedValue([
        { id: 'booking-1', bookingReference: 'AJ-000111' },
      ]);
      invoicesService.getInvoiceForFlightBooking.mockResolvedValue(
        unpaidInvoice,
      );
      invoicesService.getInvoice.mockResolvedValue(unpaidInvoice);
      paymentsService.initiateCheckout.mockResolvedValue({
        authorizationUrl: 'https://mock-checkout.example/pay',
        reference: 'CHK-ABC123',
      });

      const result = await service.requestLinkForBooking(
        'customer-1',
        'aj-000111',
      );

      expect(invoicesService.getInvoiceForFlightBooking).toHaveBeenCalledWith(
        'booking-1',
      );
      expect(result).toContain('https://mock-checkout.example/pay');
    });

    it('reports plainly when no invoice exists for an otherwise-real booking', async () => {
      flightsService.listForCustomer.mockResolvedValue([
        { id: 'booking-1', bookingReference: 'AJ-000111' },
      ]);
      invoicesService.getInvoiceForFlightBooking.mockResolvedValue(null);

      const result = await service.requestLinkForBooking(
        'customer-1',
        'AJ-000111',
      );

      expect(result).toContain('No invoice was found');
      expect(paymentsService.initiateCheckout).not.toHaveBeenCalled();
    });

    it('never creates a checkout for an already-PAID invoice', async () => {
      flightsService.listForCustomer.mockResolvedValue([
        { id: 'booking-1', bookingReference: 'AJ-000111' },
      ]);
      invoicesService.getInvoiceForFlightBooking.mockResolvedValue({
        id: 'invoice-1',
      });
      invoicesService.getInvoice.mockResolvedValue({
        ...unpaidInvoice,
        status: InvoiceStatus.PAID,
        payments: [{ amount: 150_000 }],
      });

      const result = await service.requestLinkForBooking(
        'customer-1',
        'AJ-000111',
      );

      expect(result).toContain('already fully paid');
      expect(paymentsService.initiateCheckout).not.toHaveBeenCalled();
    });

    it('never creates a checkout for a VOID invoice', async () => {
      flightsService.listForCustomer.mockResolvedValue([
        { id: 'booking-1', bookingReference: 'AJ-000111' },
      ]);
      invoicesService.getInvoiceForFlightBooking.mockResolvedValue({
        id: 'invoice-1',
      });
      invoicesService.getInvoice.mockResolvedValue({
        ...unpaidInvoice,
        status: InvoiceStatus.VOID,
      });

      const result = await service.requestLinkForBooking(
        'customer-1',
        'AJ-000111',
      );

      expect(result).toContain('No payment is currently due');
      expect(paymentsService.initiateCheckout).not.toHaveBeenCalled();
    });

    it('includes the real outstanding balance, computed from actual payments — never invents a figure', async () => {
      flightsService.listForCustomer.mockResolvedValue([
        { id: 'booking-1', bookingReference: 'AJ-000111' },
      ]);
      invoicesService.getInvoiceForFlightBooking.mockResolvedValue({
        id: 'invoice-1',
      });
      invoicesService.getInvoice.mockResolvedValue({
        ...unpaidInvoice,
        payments: [{ amount: 50_000 }],
      });
      paymentsService.initiateCheckout.mockResolvedValue({
        authorizationUrl: 'https://mock-checkout.example/pay',
        reference: 'CHK-ABC123',
      });

      const result = await service.requestLinkForBooking(
        'customer-1',
        'AJ-000111',
      );

      expect(paymentsService.initiateCheckout).toHaveBeenCalledWith(
        'customer-1',
        'invoice-1',
      );
      expect(result).toContain('100,000'); // 150,000 - 50,000
    });
  });

  describe('sendForConversation', () => {
    it('throws when the conversation has no linked (verified) customer', async () => {
      conversationsService.get.mockResolvedValue({ customerId: null });

      await expect(
        service.sendForConversation(
          'conv-1',
          'invoice-1',
          'staff-1',
          'company-a',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(invoicesService.getInvoice).not.toHaveBeenCalled();
    });

    it('sends the payment link through the normal staff-reply pipeline, attributed to the staff member', async () => {
      conversationsService.get.mockResolvedValue({
        customerId: 'customer-1',
      });
      invoicesService.getInvoice.mockResolvedValue(unpaidInvoice);
      paymentsService.initiateCheckout.mockResolvedValue({
        authorizationUrl: 'https://mock-checkout.example/pay',
        reference: 'CHK-ABC123',
      });
      conversationsService.sendReply.mockResolvedValue({ id: 'message-1' });

      await service.sendForConversation(
        'conv-1',
        'invoice-1',
        'staff-1',
        'company-a',
      );

      expect(invoicesService.getInvoice).toHaveBeenCalledWith(
        'invoice-1',
        'customer-1',
      );
      expect(conversationsService.sendReply).toHaveBeenCalledWith(
        'conv-1',
        expect.stringContaining('https://mock-checkout.example/pay'),
        'staff-1',
        'company-a',
      );
    });
  });
});
