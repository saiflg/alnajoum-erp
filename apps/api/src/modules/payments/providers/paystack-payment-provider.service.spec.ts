import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createHmac } from 'crypto';
import { PaystackPaymentProviderService } from './paystack-payment-provider.service';

/**
 * These tests mock the HTTP layer (global fetch) rather than hitting the
 * real Paystack API — there's no test-mode secret key available in this
 * environment (that requires a Paystack account only the business owner
 * can create). What's verified here is that requests are built correctly
 * and responses are parsed correctly against Paystack's documented
 * contract; a real test-mode transaction is still worth running before
 * trusting this in production — see the class-level comment.
 */
describe('PaystackPaymentProviderService', () => {
  let service: PaystackPaymentProviderService;
  let fetchMock: jest.Mock;

  beforeEach(async () => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaystackPaymentProviderService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'PAYSTACK_SECRET_KEY' ? 'sk_test_dummy' : undefined,
            ),
          },
        },
      ],
    }).compile();

    service = module.get(PaystackPaymentProviderService);
  });

  describe('initiateCheckout', () => {
    it('converts Naira to kobo and sends the expected request shape', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            status: true,
            message: 'ok',
            data: {
              authorization_url: 'https://checkout.paystack.com/abc123',
              access_code: 'abc123',
              reference: 'CHK-ABC123',
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
        'https://api.paystack.co/transaction/initialize',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer sk_test_dummy',
          }),
        }),
      );
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body).toEqual({
        email: 'amina@example.com',
        amount: 3_000_000, // 30,000 Naira -> kobo
        currency: 'NGN',
        reference: 'CHK-ABC123',
        callback_url: 'https://alnajoumtravel.example/portal/invoices/1',
      });
      expect(result).toEqual({
        authorizationUrl: 'https://checkout.paystack.com/abc123',
        reference: 'CHK-ABC123',
      });
    });

    it('throws ServiceUnavailable when Paystack rejects the request', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ status: false, message: 'Invalid key' }),
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
  });

  describe('verifyCheckout', () => {
    it('converts kobo back to Naira and maps a successful transaction', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            status: true,
            message: 'ok',
            data: {
              reference: 'CHK-ABC123',
              status: 'success',
              amount: 3_000_000,
              currency: 'NGN',
            },
          }),
      });

      const result = await service.verifyCheckout('CHK-ABC123');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.paystack.co/transaction/verify/CHK-ABC123',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer sk_test_dummy',
          }),
        }),
      );
      expect(result).toEqual({
        reference: 'CHK-ABC123',
        success: true,
        amount: 30_000,
        currency: 'NGN',
      });
    });

    it('maps a failed transaction to success: false', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            status: true,
            message: 'ok',
            data: {
              reference: 'CHK-ABC123',
              status: 'failed',
              amount: 3_000_000,
              currency: 'NGN',
            },
          }),
      });

      const result = await service.verifyCheckout('CHK-ABC123');

      expect(result.success).toBe(false);
    });
  });

  describe('verifyWebhookSignature', () => {
    it('accepts a correctly-signed body', () => {
      const rawBody = Buffer.from(JSON.stringify({ event: 'charge.success' }));
      const signature = createHmac('sha512', 'sk_test_dummy')
        .update(rawBody)
        .digest('hex');

      expect(service.verifyWebhookSignature(rawBody, signature)).toBe(true);
    });

    it('rejects a body signed with the wrong key', () => {
      const rawBody = Buffer.from(JSON.stringify({ event: 'charge.success' }));
      const signature = createHmac('sha512', 'some-other-key')
        .update(rawBody)
        .digest('hex');

      expect(service.verifyWebhookSignature(rawBody, signature)).toBe(false);
    });

    it('rejects a missing signature header', () => {
      const rawBody = Buffer.from(JSON.stringify({ event: 'charge.success' }));

      expect(service.verifyWebhookSignature(rawBody, undefined)).toBe(false);
    });
  });
});
