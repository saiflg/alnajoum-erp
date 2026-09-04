import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { HotelBookingStatus, HotelRefundStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { InvoicesService } from '../payments/invoices.service';
import { NotificationsService } from '../notifications/notifications.service';
import { HotelRefundsService } from './hotel-refunds.service';

describe('HotelRefundsService', () => {
  let service: HotelRefundsService;
  let prisma: {
    hotelBooking: { findUnique: jest.Mock; update: jest.Mock };
    hotelRefund: { create: jest.Mock; findMany: jest.Mock };
    customer: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let integrationsService: { getCredentialConfig: jest.Mock };

  const booking = {
    id: 'booking-1',
    status: HotelBookingStatus.CONFIRMED,
    totalAmount: 200_000,
    currency: 'NGN',
    checkInDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // 10 days out
    customerId: 'customer-1',
    bookingReference: 'HTL-ABCD1234',
  };

  beforeEach(async () => {
    prisma = {
      hotelBooking: { findUnique: jest.fn(), update: jest.fn() },
      hotelRefund: { create: jest.fn(), findMany: jest.fn() },
      customer: { findUnique: jest.fn() },
      $transaction: jest.fn((ops: unknown[]) =>
        Promise.all(ops as Promise<unknown>[]),
      ),
    };
    integrationsService = {
      getCredentialConfig: jest.fn().mockResolvedValue({
        freeCancellationDays: '7',
        cancellationPenaltyPercent: '30',
        agencyFeePercent: '5',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HotelRefundsService,
        { provide: PrismaService, useValue: prisma },
        { provide: IntegrationsService, useValue: integrationsService },
        {
          provide: InvoicesService,
          useValue: { voidHotelBookingIfUnpaid: jest.fn() },
        },
        { provide: NotificationsService, useValue: { sendGeneric: jest.fn() } },
        { provide: AuditService, useValue: { record: jest.fn() } },
      ],
    }).compile();
    service = module.get(HotelRefundsService);
  });

  describe('previewRefund', () => {
    it('waives the penalty when cancelling inside the free window', async () => {
      prisma.hotelBooking.findUnique.mockResolvedValue(booking); // check-in is 10 days out, free window is 7
      const preview = await service.previewRefund('booking-1');
      expect(preview.estimatedSupplierPenalty).toBe(0);
      expect(preview.agencyFee).toBe(10_000); // 5% of 200_000
      expect(preview.estimatedRefundAmount).toBe(190_000);
    });

    it('applies the configured penalty once the free window has passed', async () => {
      prisma.hotelBooking.findUnique.mockResolvedValue({
        ...booking,
        checkInDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days out, inside the penalty zone
      });
      const preview = await service.previewRefund('booking-1');
      expect(preview.estimatedSupplierPenalty).toBe(60_000); // 30% of 200_000
      expect(preview.estimatedRefundAmount).toBe(130_000); // 200_000 - 60_000 - 10_000
    });
  });

  describe('requestRefund', () => {
    it('rejects refunding an already-refunded booking', async () => {
      prisma.hotelBooking.findUnique.mockResolvedValue({
        ...booking,
        status: HotelBookingStatus.REFUNDED,
      });
      await expect(service.requestRefund('booking-1', {})).rejects.toThrow(
        ConflictException,
      );
    });

    it('never assumes the whole booking price is refunded', async () => {
      prisma.hotelBooking.findUnique.mockResolvedValue({
        ...booking,
        checkInDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      });
      prisma.hotelRefund.create.mockResolvedValue({
        id: 'refund-1',
        status: HotelRefundStatus.COMPLETED,
      });

      await service.requestRefund('booking-1', {
        requestedByStaffId: 'staff-1',
      });

      expect(prisma.hotelRefund.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            refundAmount: 130_000,
            supplierPenalty: 60_000,
            agencyFee: 10_000,
          }),
        }),
      );
      expect(prisma.hotelBooking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: HotelBookingStatus.REFUNDED },
        }),
      );
    });
  });
});
