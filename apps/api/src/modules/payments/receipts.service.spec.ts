import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ReceiptsService } from './receipts.service';

describe('ReceiptsService', () => {
  let service: ReceiptsService;
  let prisma: { payment: { findUnique: jest.Mock } };

  const customerBilledPayment = {
    id: 'payment-1',
    paymentReference: 'PAY-001',
    paidAt: new Date('2026-01-10'),
    method: 'CARD',
    amount: 50_000,
    recordedByStaff: null,
    invoice: {
      invoiceNumber: 'INV-001',
      currency: 'NGN',
      totalAmount: 50_000,
      customerId: 'customer-1',
      customer: {
        companyId: 'company-a',
        firstName: 'Amina',
        lastName: 'Bello',
      },
      payments: [{ amount: 50_000 }],
      flightBooking: null,
      hajjRegistration: null,
      umrahRegistration: null,
      corporateBooking: null,
    },
  };

  const corporateBilledPayment = {
    ...customerBilledPayment,
    id: 'payment-2',
    invoice: {
      ...customerBilledPayment.invoice,
      customerId: null,
      customer: null,
      corporateBooking: {
        corporateAccount: { name: 'Acme Corp' },
      },
    },
  };

  beforeEach(async () => {
    prisma = { payment: { findUnique: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReceiptsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(ReceiptsService);
  });

  it('throws NotFound for a missing payment', async () => {
    prisma.payment.findUnique.mockResolvedValue(null);

    await expect(service.renderPaymentReceipt('missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects a payment not owned by the requesting customer', async () => {
    prisma.payment.findUnique.mockResolvedValue(customerBilledPayment);

    await expect(
      service.renderPaymentReceipt('payment-1', 'someone-else'),
    ).rejects.toThrow(NotFoundException);
  });

  /**
   * Regression — before this fix, renderPaymentReceipt took no tenant
   * argument at all, so any staff member with INVOICE.READ from ANY
   * company could download another tenant's payment receipt PDF just by
   * guessing a paymentId.
   */
  describe('tenant isolation', () => {
    it('404s a customer-billed payment belonging to a different company', async () => {
      prisma.payment.findUnique.mockResolvedValue(customerBilledPayment);

      await expect(
        service.renderPaymentReceipt('payment-1', undefined, 'company-b'),
      ).rejects.toThrow(NotFoundException);
    });

    it('renders the receipt when the caller belongs to the same company', async () => {
      prisma.payment.findUnique.mockResolvedValue(customerBilledPayment);

      const result = await service.renderPaymentReceipt(
        'payment-1',
        undefined,
        'company-a',
      );

      expect(result.filename).toBe('PAY-001.pdf');
    });

    it('applies no tenant filter when none is given (SUPER_ADMIN)', async () => {
      prisma.payment.findUnique.mockResolvedValue(customerBilledPayment);

      const result = await service.renderPaymentReceipt('payment-1');

      expect(result.filename).toBe('PAY-001.pdf');
    });

    it('does not tenant-filter a corporate-billed payment (no customerId) — no isolation model exists for CorporateAccount yet', async () => {
      prisma.payment.findUnique.mockResolvedValue(corporateBilledPayment);

      const result = await service.renderPaymentReceipt(
        'payment-2',
        undefined,
        'company-b',
      );

      expect(result.filename).toBe('PAY-001.pdf');
    });
  });
});
