import { IntegrationCategory } from '@prisma/client';

export interface IntegrationFieldSpec {
  key: string;
  label: string;
  /** Rendered as a password-style input and never echoed back once saved. */
  secret: boolean;
  placeholder?: string;
}

export interface IntegrationProviderSpec {
  provider: string;
  label: string;
  /** Empty for "mock" — nothing to configure. */
  fields: IntegrationFieldSpec[];
  /** True once the concrete *Service class actually calls the real API
   * instead of throwing NotImplementedException. Surfaced in the settings
   * UI so "Sabre" and "Amadeus" showing up isn't mistaken for them being
   * wired up — they're catalog/credential-storage entries only, exactly
   * what was asked for ("add a place to add my API... start with Duffel"). */
  implemented: boolean;
  docsUrl?: string;
}

/**
 * Single source of truth for what the /admin/integrations settings page
 * renders per category, and what IntegrationsService/the provider routers
 * recognize as valid provider names. Adding a new provider (a real Sabre
 * implementation, say) means: write the *ProviderService class, register it
 * in the module + router, and add its field spec here.
 */
export const INTEGRATION_CATALOG: Record<
  IntegrationCategory,
  IntegrationProviderSpec[]
> = {
  FLIGHT: [
    { provider: 'mock', label: 'Mock (built-in, no credentials needed)', fields: [], implemented: true },
    {
      provider: 'duffel',
      label: 'Duffel',
      implemented: true,
      docsUrl: 'https://duffel.com/docs/api',
      fields: [
        { key: 'apiKey', label: 'API Key', secret: true, placeholder: 'duffel_test_...' },
      ],
    },
    {
      provider: 'sabre',
      label: 'Sabre',
      implemented: false,
      docsUrl: 'https://developer.sabre.com',
      fields: [
        { key: 'clientId', label: 'Client ID', secret: false },
        { key: 'clientSecret', label: 'Client Secret', secret: true },
        { key: 'pcc', label: 'Pseudo City Code (PCC)', secret: false },
      ],
    },
    {
      provider: 'amadeus',
      label: 'Amadeus',
      implemented: false,
      docsUrl: 'https://developers.amadeus.com',
      fields: [
        { key: 'apiKey', label: 'API Key', secret: false },
        { key: 'apiSecret', label: 'API Secret', secret: true },
      ],
    },
  ],
  PAYMENT: [
    { provider: 'mock', label: 'Mock (simulates a successful checkout)', fields: [], implemented: true },
    {
      provider: 'paystack',
      label: 'Paystack',
      implemented: true,
      docsUrl: 'https://dashboard.paystack.com',
      fields: [{ key: 'secretKey', label: 'Secret Key', secret: true, placeholder: 'sk_test_...' }],
    },
    {
      provider: 'opay',
      label: 'OPay',
      implemented: true,
      docsUrl: 'https://merchant.opayweb.com',
      fields: [
        { key: 'secretKey', label: 'Secret Key', secret: true },
        { key: 'merchantId', label: 'Merchant ID', secret: false },
      ],
    },
  ],
  NOTIFICATION: [
    { provider: 'mock', label: 'Mock (logs instead of sending)', fields: [], implemented: true },
    {
      provider: 'smtp',
      label: 'SMTP',
      implemented: true,
      fields: [
        { key: 'host', label: 'SMTP Host', secret: false, placeholder: 'smtp.gmail.com' },
        { key: 'port', label: 'Port', secret: false, placeholder: '587' },
        { key: 'user', label: 'Username', secret: false },
        { key: 'password', label: 'Password', secret: true },
        { key: 'from', label: 'From address', secret: false, placeholder: 'Alnajoum Travel <no-reply@...>' },
        { key: 'secure', label: 'Use TLS (true/false)', secret: false, placeholder: 'false' },
      ],
    },
  ],
};
