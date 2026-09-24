import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { FlightsService } from '../flights/flights.service';
import { WhatsAppSelfServiceService } from './whatsapp-self-service.service';

describe('WhatsAppSelfServiceService', () => {
  let service: WhatsAppSelfServiceService;
  let prisma: { customer: { findFirst: jest.Mock } };
  let flightsService: { listForCustomer: jest.Mock };

  beforeEach(async () => {
    prisma = { customer: { findFirst: jest.fn() } };
    flightsService = { listForCustomer: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppSelfServiceService,
        { provide: PrismaService, useValue: prisma },
        { provide: FlightsService, useValue: flightsService },
      ],
    }).compile();

    service = module.get(WhatsAppSelfServiceService);
  });

  describe('command matchers', () => {
    it.each(['booking', 'my PNR', 'ticket status', 'FLIGHT', '1'])(
      'requiresVerification("%s") is true',
      (text) => {
        expect(WhatsAppSelfServiceService.requiresVerification(text)).toBe(
          true,
        );
      },
    );

    it('requiresVerification is false for an unrelated message', () => {
      expect(
        WhatsAppSelfServiceService.requiresVerification('hello there'),
      ).toBe(false);
    });

    it.each(['agent', 'staff', 'human', '2'])(
      'requestsAgent("%s") is true',
      (text) => {
        expect(WhatsAppSelfServiceService.requestsAgent(text)).toBe(true);
      },
    );

    it.each(['menu', 'hi', 'hello'])('requestsMenu("%s") is true', (text) => {
      expect(WhatsAppSelfServiceService.requestsMenu(text)).toBe(true);
    });

    it.each(['help', '3'])('requestsHelp("%s") is true', (text) => {
      expect(WhatsAppSelfServiceService.requestsHelp(text)).toBe(true);
    });

    it.each([
      ['pay AJ-000123', 'AJ-000123'],
      ['PAY aj-000123', 'aj-000123'],
      ['  pay   AJ-1  ', 'AJ-1'],
    ])('parsePaymentRequest("%s") extracts "%s"', (text, expected) => {
      expect(WhatsAppSelfServiceService.parsePaymentRequest(text)).toBe(
        expected,
      );
    });

    it.each(['pay', 'pay ', 'payment', 'hello'])(
      'parsePaymentRequest("%s") is null — never guesses a booking',
      (text) => {
        expect(WhatsAppSelfServiceService.parsePaymentRequest(text)).toBeNull();
      },
    );
  });

  describe('myBookings', () => {
    it('reports no bookings plainly rather than fabricating one', async () => {
      flightsService.listForCustomer.mockResolvedValue([]);

      const result = await service.myBookings('customer-1');

      expect(result).toContain("don't have any flight bookings");
    });

    it('formats real booking facts only — reference, route, date, status', async () => {
      flightsService.listForCustomer.mockResolvedValue([
        {
          bookingReference: 'AJ-000123',
          origin: 'KAN',
          destination: 'JED',
          departureAt: new Date('2027-01-10T08:00:00.000Z'),
          status: 'TICKETED',
        },
      ]);

      const result = await service.myBookings('customer-1');

      expect(result).toContain('AJ-000123');
      expect(result).toContain('KAN → JED');
      expect(result).toContain('2027-01-10');
      expect(result).toContain('TICKETED');
    });

    it('shows only the 3 most recent bookings', async () => {
      flightsService.listForCustomer.mockResolvedValue(
        Array.from({ length: 5 }, (_, i) => ({
          bookingReference: `AJ-00000${i}`,
          origin: 'KAN',
          destination: 'JED',
          departureAt: new Date(),
          status: 'TICKETED',
        })),
      );

      const result = await service.myBookings('customer-1');

      expect(result.split('\n\n')).toHaveLength(3);
    });
  });

  describe('findVerifiedCustomer', () => {
    it('only matches a customer whose WhatsApp number is verified', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      await service.findVerifiedCustomer('+2348031234567');

      expect(prisma.customer.findFirst).toHaveBeenCalledWith({
        where: {
          whatsapp: '+2348031234567',
          whatsappVerifiedAt: { not: null },
        },
      });
    });
  });
});
