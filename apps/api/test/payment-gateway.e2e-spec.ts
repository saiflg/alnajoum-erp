import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createHmac } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/bootstrap';

const BOOTSTRAP_ADMIN_EMAIL = 'admin@alnajoum.travel';
const BOOTSTRAP_ADMIN_PASSWORD = 'Alnajoum@2026';
const PAYSTACK_SECRET_KEY = 'test_paystack_secret_do_not_use_in_production';

const RUN_ID = `pg-${Date.now().toString(36)}`;

const SEARCH_BODY = {
  tripType: 'ONE_WAY',
  legs: [{ origin: 'LOS', destination: 'ABV', departureDate: '2027-05-15' }],
  adults: 1,
};

async function registerAndLogin(
  server: App,
  email: string,
  firstName: string,
): Promise<string> {
  await request(server)
    .post('/api/v1/auth/register')
    .send({ email, password: 'Passw0rd1', firstName, lastName: 'Test' })
    .expect(201);
  const res = await request(server)
    .post('/api/v1/auth/login')
    .send({ email, password: 'Passw0rd1' });
  return res.body.data.accessToken as string;
}

async function bookFlight(
  server: App,
  token: string,
): Promise<{ invoiceId: string; invoiceTotal: number }> {
  const searchRes = await request(server)
    .post('/api/v1/flights/search')
    .set('Authorization', `Bearer ${token}`)
    .send(SEARCH_BODY)
    .expect(201);
  const offerId = searchRes.body.data[0].id as string;
  const invoiceTotal = searchRes.body.data[0].totalAmount as number;

  await request(server)
    .post('/api/v1/flights/bookings/me')
    .set('Authorization', `Bearer ${token}`)
    .send({ offerId, passengers: [{ type: 'ADULT' }] })
    .expect(201);

  const invoicesRes = await request(server)
    .get('/api/v1/invoices/me')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  return { invoiceId: invoicesRes.body.data[0].id as string, invoiceTotal };
}

function signPaystackBody(body: unknown): { raw: Buffer; signature: string } {
  const raw = Buffer.from(JSON.stringify(body));
  const signature = createHmac('sha512', PAYSTACK_SECRET_KEY)
    .update(raw)
    .digest('hex');
  return { raw, signature };
}

describe('Payment Gateway checkout (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let adminAccessToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    // rawBody: true — same as main.ts — needed for the webhook signature
    // tests below, which sign the exact raw bytes of the request.
    app = moduleFixture.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    server = app.getHttpServer();

    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({
        email: BOOTSTRAP_ADMIN_EMAIL,
        password: BOOTSTRAP_ADMIN_PASSWORD,
      })
      .expect(201);
    adminAccessToken = res.body.data.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('full checkout flow against the mock provider', () => {
    const email = `${RUN_ID}.customer@example.com`;
    let token: string;
    let invoiceId: string;
    let invoiceTotal: number;
    let reference: string;

    beforeAll(async () => {
      token = await registerAndLogin(server, email, 'Checkout');
      ({ invoiceId, invoiceTotal } = await bookFlight(server, token));
    });

    it('starts a checkout and returns a mock authorization URL carrying the reference/amount/callback', async () => {
      const res = await request(server)
        .post(`/api/v1/invoices/me/${invoiceId}/checkout`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      reference = res.body.data.reference;
      expect(reference).toMatch(/^CHK-/);

      const url = new URL(res.body.data.authorizationUrl);
      expect(url.pathname).toBe('/checkout/mock');
      expect(url.searchParams.get('reference')).toBe(reference);
      expect(url.searchParams.get('amount')).toBe(String(invoiceTotal));
      expect(url.searchParams.get('currency')).toBe('NGN');
      expect(url.searchParams.get('callback')).toContain(
        `checkout_reference=${reference}`,
      );
    });

    it("rejects another customer's checkout attempt on this invoice", async () => {
      const otherToken = await registerAndLogin(
        server,
        `${RUN_ID}.other@example.com`,
        'Other',
      );

      await request(server)
        .post(`/api/v1/invoices/me/${invoiceId}/checkout`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(403);
    });

    it('confirms the checkout, records an ONLINE payment, and marks the invoice PAID', async () => {
      const res = await request(server)
        .post(`/api/v1/invoices/me/${invoiceId}/checkout/verify`)
        .set('Authorization', `Bearer ${token}`)
        .send({ reference })
        .expect(201);

      expect(res.body.data.status).toBe('PAID');

      const adminRes = await request(server)
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      const onlinePayment = (
        adminRes.body.data.payments as Array<{
          method: string;
          amount: number;
          recordedByStaffId: string | null;
        }>
      ).find((p) => p.method === 'ONLINE');
      expect(onlinePayment).toBeTruthy();
      expect(onlinePayment?.amount).toBe(invoiceTotal);
      expect(onlinePayment?.recordedByStaffId).toBeNull();
    });

    it('is idempotent — verifying the same reference again returns the same PAID state without a duplicate payment', async () => {
      const res = await request(server)
        .post(`/api/v1/invoices/me/${invoiceId}/checkout/verify`)
        .set('Authorization', `Bearer ${token}`)
        .send({ reference })
        .expect(201);

      expect(res.body.data.status).toBe('PAID');

      const adminRes = await request(server)
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);
      const onlinePayments = (
        adminRes.body.data.payments as Array<{ method: string }>
      ).filter((p) => p.method === 'ONLINE');
      expect(onlinePayments).toHaveLength(1);
    });

    it('rejects starting a new checkout once the invoice has no outstanding balance', async () => {
      await request(server)
        .post(`/api/v1/invoices/me/${invoiceId}/checkout`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
    });
  });

  describe('webhook-confirmed checkout (browser never returns)', () => {
    const email = `${RUN_ID}.webhook@example.com`;
    let token: string;
    let invoiceId: string;
    let invoiceTotal: number;
    let reference: string;

    beforeAll(async () => {
      token = await registerAndLogin(server, email, 'Webhook');
      ({ invoiceId, invoiceTotal } = await bookFlight(server, token));

      const res = await request(server)
        .post(`/api/v1/invoices/me/${invoiceId}/checkout`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      reference = res.body.data.reference;
    });

    it('rejects a webhook with an invalid signature', async () => {
      const payload = {
        event: 'charge.success',
        data: {
          reference,
          status: 'success',
          amount: invoiceTotal * 100,
          currency: 'NGN',
        },
      };

      await request(server)
        .post('/api/v1/webhooks/paystack')
        .set('x-paystack-signature', 'not-a-real-signature')
        .send(payload)
        .expect(401);
    });

    it('finalizes the payment via a correctly-signed webhook alone (no customer verify call)', async () => {
      const payload = {
        event: 'charge.success',
        data: {
          reference,
          status: 'success',
          amount: invoiceTotal * 100, // kobo
          currency: 'NGN',
        },
      };
      const { signature } = signPaystackBody(payload);

      await request(server)
        .post('/api/v1/webhooks/paystack')
        .set('x-paystack-signature', signature)
        .send(payload)
        .expect(201);

      const adminRes = await request(server)
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);
      expect(adminRes.body.data.status).toBe('PAID');
      const onlinePayment = (
        adminRes.body.data.payments as Array<{ method: string }>
      ).find((p) => p.method === 'ONLINE');
      expect(onlinePayment).toBeTruthy();
    });

    it('ignores an unrecognized event type without error', async () => {
      const payload = { event: 'charge.dispute.create', data: undefined };
      const { signature } = signPaystackBody(payload);

      await request(server)
        .post('/api/v1/webhooks/paystack')
        .set('x-paystack-signature', signature)
        .send(payload)
        .expect(201);
    });
  });
});
