import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { IntegrationsService } from '../../integrations/integrations.service';
import { OpayPaymentProviderService } from './opay-payment-provider.service';

/**
 * Same caveat as paystack-payment-provider.service.spec.ts, doubled: these
 * mock the HTTP layer rather than hitting a real OPay account (no
 * merchant account available in this environment), and — unlike
 * Paystack — the request/response shapes under test here are OPay's
 * documented contract as best recalled, not independently confirmed
 * against a live account. See the class-level comment on
 * OpayPaymentProviderService.
 */
describe('OpayPaymentProviderService', () => {
  let service: OpayPaymentProviderService;
  let fetchMock: jest.Mock;

  beforeEach(async () => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpayPaymentProviderService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'OPAY_SECRET_KEY') return 'opay_test_secret';
              if (key === 'OPAY_MERCHANT_ID') return '256620111100000';
              return undefined;
            }),
          },
        },
        {
          provide: IntegrationsService,
          useValue: { getCredentialConfig: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    service = module.get(OpayPaymentProviderService);
  });

  describe('initiateCheckout', () => {
    it('converts Naira to kobo, wraps it in amount.total, and sends the expected request shape', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            code: '00000',
            message: 'SUCCESSFUL',
            data: {
              reference: 'CHK-ABC123',
              orderNo: '210316152122060936',
              status: 'INITIAL',
              cashierUrl: 'https://cashier.opaycheckout.com/pay/abc123',
            },
          }),
      });

      const result = await service.initiateCheckout({
        reference: 'CHK-ABC123',
        amount: 30_000,
        currency: 'NGN',
        customerEmail: 'amina@example.com',
        callbackUrl: 'https://alnajoumtravel.example/portal/invoices/1',
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://liveapi.opaycheckout.com/api/v1/international/cashier/create',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer opay_test_secret',
            MerchantId: '256620111100000',
          }),
        }),
      );
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body).toMatchObject({
        reference: 'CHK-ABC123',
        amount: { total: 3_000_000, currency: 'NGN' },
      });
      expect(result).toEqual({
        authorizationUrl: 'https://cashier.opaycheckout.com/pay/abc123',
        reference: 'CHK-ABC123',
      });
    });

    it('throws ServiceUnavailable when OPay rejects the request', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ code: '00001', message: 'Invalid signature' }),
      });

      await expect(
        service.initiateCheckout({
          reference: 'CHK-ABC123',
          amount: 30_000,
          currency: 'NGN',
          customerEmail: 'amina@example.com',
          callbackUrl: 'https://alnajoumtravel.example/portal/invoices/1',
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('throws ServiceUnavailable when OPAY_MERCHANT_ID is not configured', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          OpayPaymentProviderService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) =>
                key === 'OPAY_SECRET_KEY' ? 'opay_test_secret' : undefined,
              ),
            },
          },
          {
            provide: IntegrationsService,
            useValue: { getCredentialConfig: jest.fn().mockResolvedValue(null) },
          },
        ],
      }).compile();
      const unconfigured = module.get(OpayPaymentProviderService);

      await expect(
        unconfigured.initiateCheckout({
          reference: 'CHK-ABC123',
          amount: 30_000,
          currency: 'NGN',
          customerEmail: 'amina@example.com',
          callbackUrl: 'https://alnajoumtravel.example/portal/invoices/1',
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('verifyCheckout', () => {
    it('converts kobo back to Naira and maps a SUCCESS order to success: true', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            code: '00000',
            message: 'SUCCESSFUL',
            data: {
              reference: 'CHK-ABC123',
              orderNo: '210316152122060936',
              status: 'SUCCESS',
              amount: { total: 3_000_000, currency: 'NGN' },
            },
          }),
      });

      const result = await service.verifyCheckout('CHK-ABC123');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://liveapi.opaycheckout.com/api/v1/international/cashier/status',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(result).toEqual({
        reference: 'CHK-ABC123',
        success: true,
        amount: 30_000,
        currency: 'NGN',
      });
    });

    it('maps a FAIL order to success: false', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            code: '00000',
            message: 'SUCCESSFUL',
            data: {
              reference: 'CHK-ABC123',
              orderNo: '210316152122060936',
              status: 'FAIL',
              amount: { total: 3_000_000, currency: 'NGN' },
            },
          }),
      });

      const result = await service.verifyCheckout('CHK-ABC123');

      expect(result.success).toBe(false);
    });
  });
});
