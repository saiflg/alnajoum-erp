import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { MockPaymentProviderService } from './mock-payment-provider.service';

describe('MockPaymentProviderService', () => {
  let service: MockPaymentProviderService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MockPaymentProviderService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((_key: string, fallback?: unknown) => fallback),
          },
        },
      ],
    }).compile();

    service = module.get(MockPaymentProviderService);
  });

  it('builds a mock checkout URL carrying the reference, amount, currency, and callback', async () => {
    const result = await service.initiateCheckout({
      reference: 'CHK-ABC123',
      amount: 30_000,
      currency: 'NGN',
      customerEmail: 'amina@example.com',
      callbackUrl:
        'http://localhost:3000/portal/invoices/invoice-1?checkout_reference=CHK-ABC123',
    });

    expect(result.reference).toBe('CHK-ABC123');
    const url = new URL(result.authorizationUrl);
    expect(url.pathname).toBe('/checkout/mock');
    expect(url.searchParams.get('reference')).toBe('CHK-ABC123');
    expect(url.searchParams.get('amount')).toBe('30000');
    expect(url.searchParams.get('currency')).toBe('NGN');
    expect(url.searchParams.get('callback')).toContain(
      'checkout_reference=CHK-ABC123',
    );
  });

  it('always reports a successful verification, with no independently-verified amount', async () => {
    const result = await service.verifyCheckout('CHK-ABC123');

    expect(result).toEqual({
      reference: 'CHK-ABC123',
      success: true,
      amount: 0,
      currency: '',
    });
  });
});
