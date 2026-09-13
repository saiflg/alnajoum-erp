import { Test, TestingModule } from '@nestjs/testing';
import { CustomersService } from '../customers/customers.service';
import { FlightsService } from '../flights/flights.service';
import { InvoicesService } from '../payments/invoices.service';
import { DataExportService } from './data-export.service';

describe('DataExportService', () => {
  let service: DataExportService;
  let customersService: { findAll: jest.Mock };
  let flightsService: { listAll: jest.Mock };
  let invoicesService: { listAll: jest.Mock };

  beforeEach(async () => {
    customersService = { findAll: jest.fn() };
    flightsService = { listAll: jest.fn() };
    invoicesService = { listAll: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataExportService,
        { provide: CustomersService, useValue: customersService },
        { provide: FlightsService, useValue: flightsService },
        { provide: InvoicesService, useValue: invoicesService },
      ],
    }).compile();

    service = module.get(DataExportService);
  });

  describe('exportCustomers', () => {
    it('passes the tenant filter through to CustomersService.findAll', async () => {
      customersService.findAll.mockResolvedValue([]);

      await service.exportCustomers('company-a');

      expect(customersService.findAll).toHaveBeenCalledWith({}, 'company-a');
    });

    it('renders one CSV row per customer with the identity fields flattened in', async () => {
      customersService.findAll.mockResolvedValue([
        {
          id: 'cust-1',
          firstName: 'Amina',
          lastName: 'Yusuf',
          identity: {
            email: 'amina@example.com',
            phone: '+2348012345678',
            status: 'ACTIVE',
          },
          assignedStaff: { firstName: 'Fatima', lastName: 'Sule' },
          assignedBranch: { name: 'Kaduna HQ' },
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ]);

      const result = await service.exportCustomers('company-a');

      expect(result.filename).toMatch(/^customers-.*\.csv$/);
      expect(result.content).toContain('amina@example.com');
      expect(result.content).toContain('Fatima Sule');
      expect(result.content).toContain('Kaduna HQ');
    });

    it('renders empty strings for a customer with no assigned staff/branch', async () => {
      customersService.findAll.mockResolvedValue([
        {
          id: 'cust-1',
          firstName: 'Amina',
          lastName: 'Yusuf',
          identity: {
            email: 'amina@example.com',
            phone: null,
            status: 'ACTIVE',
          },
          assignedStaff: null,
          assignedBranch: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ]);

      const result = await service.exportCustomers('company-a');

      const dataLine = result.content.split('\n')[1];
      expect(dataLine.split(',')).toEqual(
        expect.arrayContaining(['cust-1', 'Amina', 'Yusuf']),
      );
    });
  });

  describe('exportInvoices', () => {
    it('sums multiple payments into one "Amount Paid" column, and blanks a nullable customer', async () => {
      invoicesService.listAll.mockResolvedValue([
        {
          invoiceNumber: 'INV-1',
          customer: null,
          status: 'PAID',
          currency: 'NGN',
          totalAmount: 100_000,
          payments: [{ amount: 60_000 }, { amount: 40_000 }],
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ]);

      const result = await service.exportInvoices('company-a');
      const dataLine = result.content.split('\n')[1];
      const [
        invoiceNumber,
        customer,
        status,
        currency,
        totalAmount,
        amountPaid,
      ] = dataLine.split(',');

      expect(invoiceNumber).toBe('INV-1');
      expect(customer).toBe('');
      expect(status).toBe('PAID');
      expect(currency).toBe('NGN');
      expect(totalAmount).toBe('100000');
      expect(amountPaid).toBe('100000'); // 60_000 + 40_000
    });
  });

  describe('exportFlightBookings', () => {
    it('scopes via FlightsService.listAll and renders the route/customer', async () => {
      flightsService.listAll.mockResolvedValue([
        {
          bookingReference: 'ANJ-1',
          customer: { firstName: 'Amina', lastName: 'Yusuf' },
          status: 'TICKETED',
          origin: 'LOS',
          destination: 'ABV',
          departureAt: new Date('2027-01-10T08:00:00.000Z'),
          currency: 'NGN',
          totalAmount: 50_000,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ]);

      const result = await service.exportFlightBookings('company-a');

      expect(flightsService.listAll).toHaveBeenCalledWith({}, 'company-a');
      expect(result.content).toContain('ANJ-1');
      expect(result.content).toContain('Amina Yusuf');
      expect(result.content).toContain('LOS');
    });
  });
});
