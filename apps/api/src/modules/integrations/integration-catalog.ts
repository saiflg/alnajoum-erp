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
/**
 * Common per-provider operational config every flight provider gets on top
 * of its own auth fields (spec's "Provider Configuration" list: Environment,
 * Currency, Priority, Markup, Timeout, Retry Policy — "Enabled/Disabled" is
 * handled separately by IntegrationsService.setActive, not a field here).
 * Stored the same schemaless way as every other field: inside
 * IntegrationCredential.config, read back by FlightProviderRouter/each
 * *ProviderService as needed.
 */
const FLIGHT_PROVIDER_CONFIG_FIELDS: IntegrationFieldSpec[] = [
  {
    key: 'environment',
    label: 'Environment (sandbox / production)',
    secret: false,
    placeholder: 'sandbox',
  },
  {
    key: 'currency',
    label: 'Default Currency',
    secret: false,
    placeholder: 'NGN',
  },
  {
    key: 'priority',
    label: 'Priority (higher tried first if multiple are enabled)',
    secret: false,
    placeholder: '0',
  },
  {
    key: 'markupPercent',
    label: 'Default Markup % (fallback when no pricing rule matches)',
    secret: false,
    placeholder: '0',
  },
  {
    key: 'agencyFeePercent',
    label: 'Agency Cancellation Fee % (deducted from refunds)',
    secret: false,
    placeholder: '5',
  },
  {
    key: 'changePenaltyPercent',
    label: 'Agency Change/Reissue Penalty % (added on top of fare difference)',
    secret: false,
    placeholder: '3',
  },
  {
    key: 'timeoutMs',
    label: 'Request Timeout (ms)',
    secret: false,
    placeholder: '15000',
  },
  {
    key: 'retryCount',
    label: 'Retry Attempts on Timeout/5xx',
    secret: false,
    placeholder: '1',
  },
];

export const INTEGRATION_CATALOG: Record<
  IntegrationCategory,
  IntegrationProviderSpec[]
> = {
  FLIGHT: [
    {
      provider: 'mock',
      label: 'Mock (built-in, no credentials needed)',
      fields: [],
      implemented: true,
    },
    {
      provider: 'duffel',
      label: 'Duffel',
      implemented: true,
      docsUrl: 'https://duffel.com/docs/api',
      fields: [
        {
          key: 'apiKey',
          label: 'API Key',
          secret: true,
          placeholder: 'duffel_test_...',
        },
        ...FLIGHT_PROVIDER_CONFIG_FIELDS,
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
        ...FLIGHT_PROVIDER_CONFIG_FIELDS,
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
        ...FLIGHT_PROVIDER_CONFIG_FIELDS,
      ],
    },
    {
      provider: 'travelport',
      label: 'Travelport',
      implemented: false,
      docsUrl: 'https://developer.travelport.com',
      fields: [
        { key: 'clientId', label: 'Client ID', secret: false },
        { key: 'clientSecret', label: 'Client Secret', secret: true },
        { key: 'accessGroup', label: 'Access Group', secret: false },
        ...FLIGHT_PROVIDER_CONFIG_FIELDS,
      ],
    },
    {
      provider: 'tbo',
      label: 'TBO (Travel Boutique Online)',
      implemented: false,
      docsUrl: 'https://tektravels.com',
      fields: [
        { key: 'username', label: 'Agency Username', secret: false },
        { key: 'password', label: 'Agency Password', secret: true },
        ...FLIGHT_PROVIDER_CONFIG_FIELDS,
      ],
    },
  ],
  HOTEL: [
    {
      provider: 'mock',
      label: 'Mock (built-in, no credentials needed — external search demo)',
      fields: [
        {
          key: 'freeCancellationDays',
          label: 'Free Cancellation Window (days before check-in)',
          secret: false,
          placeholder: '2',
        },
        {
          key: 'cancellationPenaltyPercent',
          label: 'Cancellation Penalty % (after the free window)',
          secret: false,
          placeholder: '25',
        },
        {
          key: 'agencyFeePercent',
          label: 'Agency Cancellation Fee % (deducted from every refund)',
          secret: false,
          placeholder: '5',
        },
      ],
      implemented: true,
    },
  ],
  PAYMENT: [
    {
      provider: 'mock',
      label: 'Mock (simulates a successful checkout)',
      fields: [],
      implemented: true,
    },
    {
      provider: 'paystack',
      label: 'Paystack',
      implemented: true,
      docsUrl: 'https://dashboard.paystack.com',
      fields: [
        {
          key: 'secretKey',
          label: 'Secret Key',
          secret: true,
          placeholder: 'sk_test_...',
        },
      ],
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
  VISA: [
    {
      provider: 'manual',
      label:
        'Manual / Offline (default — staff coordinate with embassy/agent directly)',
      fields: [
        {
          key: 'refundAgencyFeePercent',
          label: 'Agency Cancellation Fee % (deducted from every visa refund)',
          secret: false,
          placeholder: '5',
        },
      ],
      implemented: true,
    },
    {
      provider: 'mock',
      label: 'Mock (built-in, simulates a visa-center API for demo/testing)',
      fields: [
        {
          key: 'refundAgencyFeePercent',
          label: 'Agency Cancellation Fee % (deducted from every visa refund)',
          secret: false,
          placeholder: '5',
        },
      ],
      implemented: true,
    },
  ],
  AI: [
    {
      provider: 'mock',
      label: 'Mock (built-in, no credentials needed — keyword-matched demo)',
      fields: [
        {
          key: 'dailyRequestLimit',
          label: 'Daily Request Limit (per company)',
          secret: false,
          placeholder: '200',
        },
      ],
      implemented: true,
    },
    {
      provider: 'openai-compatible',
      label: 'OpenAI-compatible (OpenAI, Groq, OpenRouter, self-hosted, etc.)',
      implemented: true,
      docsUrl: 'https://platform.openai.com/docs/api-reference/chat',
      fields: [
        {
          key: 'apiKey',
          label: 'API Key',
          secret: true,
          placeholder: 'sk-...',
        },
        {
          key: 'baseUrl',
          label: 'API Base URL (default: https://api.openai.com/v1)',
          secret: false,
          placeholder: 'https://api.openai.com/v1',
        },
        {
          key: 'model',
          label: 'Model (default: gpt-4o-mini)',
          secret: false,
          placeholder: 'gpt-4o-mini',
        },
        {
          key: 'temperature',
          label: 'Temperature (0-2, default 0.2)',
          secret: false,
          placeholder: '0.2',
        },
        {
          key: 'dailyRequestLimit',
          label: 'Daily Request Limit (per company)',
          secret: false,
          placeholder: '200',
        },
      ],
    },
  ],
  WHATSAPP: [
    {
      provider: 'mock',
      label: 'Mock (built-in, no credentials needed — dev simulator)',
      fields: [],
      implemented: true,
    },
    {
      provider: 'meta',
      label: 'Meta WhatsApp Cloud API',
      implemented: true,
      docsUrl: 'https://developers.facebook.com/docs/whatsapp/cloud-api',
      fields: [
        {
          key: 'accessToken',
          label: 'Access Token',
          secret: true,
          placeholder: 'EAAG...',
        },
        {
          key: 'phoneNumberId',
          label: 'Phone Number ID',
          secret: false,
        },
        {
          key: 'businessAccountId',
          label: 'WhatsApp Business Account ID',
          secret: false,
        },
        {
          key: 'appSecret',
          label: 'App Secret (for webhook signature verification)',
          secret: true,
        },
        {
          key: 'webhookVerifyToken',
          label:
            "Webhook Verify Token (you choose this — enter the same value in Meta's webhook setup)",
          secret: true,
        },
        {
          key: 'apiVersion',
          label: 'API Version (default: v21.0)',
          secret: false,
          placeholder: 'v21.0',
        },
      ],
    },
  ],
  NOTIFICATION: [
    {
      provider: 'mock',
      label: 'Mock (logs instead of sending)',
      fields: [],
      implemented: true,
    },
    {
      provider: 'smtp',
      label: 'SMTP',
      implemented: true,
      fields: [
        {
          key: 'host',
          label: 'SMTP Host',
          secret: false,
          placeholder: 'smtp.gmail.com',
        },
        { key: 'port', label: 'Port', secret: false, placeholder: '587' },
        { key: 'user', label: 'Username', secret: false },
        { key: 'password', label: 'Password', secret: true },
        {
          key: 'from',
          label: 'From address',
          secret: false,
          placeholder: 'Alnajoum Travel <no-reply@...>',
        },
        {
          key: 'secure',
          label: 'Use TLS (true/false)',
          secret: false,
          placeholder: 'false',
        },
      ],
    },
  ],
};
