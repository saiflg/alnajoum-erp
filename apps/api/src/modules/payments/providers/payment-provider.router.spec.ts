import { ServiceUnavailableException } from '@nestjs/common';
import { PaymentProviderRouter } from './payment-provider.router';

const make = (
  nodeEnv: string,
  configured = 'mock',
  active: string | null = null,
) => {
  const mock = { name: 'mock' };
  const paystack = { name: 'paystack' };
  const opay = { name: 'opay' };
  const router = new PaymentProviderRouter(
    { getActiveProvider: jest.fn().mockResolvedValue(active) } as never,
    {
      get: jest.fn((k: string, d?: string) =>
        k === 'NODE_ENV' ? nodeEnv : k === 'PAYMENT_PROVIDER' ? configured : d,
      ),
    } as never,
    mock as never,
    paystack as never,
    opay as never,
  );
  return { router, mock, paystack, opay };
};

describe('PaymentProviderRouter production guard', () => {
  it('returns the mock provider outside production', () => {
    const { router, mock } = make('development');
    expect(router.resolveByName('mock')).toBe(mock);
    expect(router.resolveByName('something-unknown')).toBe(mock);
  });

  it('refuses the mock and unknown providers in production', () => {
    const { router } = make('production');
    expect(() => router.resolveByName('mock')).toThrow(
      ServiceUnavailableException,
    );
    expect(() => router.resolveByName('something-unknown')).toThrow(
      ServiceUnavailableException,
    );
  });

  it('still resolves real providers in production', () => {
    const { router, paystack, opay } = make('production');
    expect(router.resolveByName('paystack')).toBe(paystack);
    expect(router.resolveByName('opay')).toBe(opay);
  });

  it('refuses to initiate checkout when production is left on the default mock provider', async () => {
    const { router } = make('production', 'mock', null);
    await expect(
      router.initiateCheckout({
        reference: 'CHK-1',
        amount: 1,
        currency: 'NGN',
        customerEmail: 'a@b.c',
        callbackUrl: 'http://x',
      }),
    ).rejects.toThrow(ServiceUnavailableException);
    await expect(router.verifyCheckout('CHK-1')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});
