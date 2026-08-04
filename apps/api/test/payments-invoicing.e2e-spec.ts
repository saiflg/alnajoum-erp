import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/bootstrap';

const BOOTSTRAP_ADMIN_EMAIL = 'admin@alnajoum.travel';
const BOOTSTRAP_ADMIN_PASSWORD = 'Alnajoum@2026';

const RUN_ID = `pay-${Date.now().toString(36)}`;

const SEARCH_BODY = {
  tripType: 'ONE_WAY',
  legs: [{ origin: 'LOS', destination: 'ABV', departureDate: '2027-05-10' }],
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
): Promise<{ bookingId: string; invoiceTotal: number }> {
  const searchRes = await request(server)
    .post('/api/v1/flights/search')
    .set('Authorization', `Bearer ${token}`)
    .send(SEARCH_BODY)
    .expect(201);
  const offerId = searchRes.body.data[0].id as string;
  const totalAmount = searchRes.body.data[0].totalAmount as number;

  const bookingRes = await request(server)
    .post('/api/v1/flights/bookings/me')
    .set('Authorization', `Bearer ${token}`)
    .send({ offerId, passengers: [{ type: 'ADULT' }] })
    .expect(201);

  return {
    bookingId: bookingRes.body.data.id as string,
    invoiceTotal: totalAmount,
  };
}

describe('Payments & Invoicing (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let adminAccessToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
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

  describe('auto-generated invoice on booking', () => {
    const email = `${RUN_ID}.customer@example.com`;
    let token: string;
    let bookingId: string;
    let invoiceTotal: number;
    let invoiceId: string;

    it('books a flight and finds a matching ISSUED invoice', async () => {
      token = await registerAndLogin(server, email, 'Amina');
      ({ bookingId, invoiceTotal } = await bookFlight(server, token));

      const listRes = await request(server)
        .get('/api/v1/invoices/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const invoice = listRes.body.data.find(
        (inv: { flightBookingId: string }) => inv.flightBookingId === bookingId,
      );
      expect(invoice).toBeTruthy();
      expect(invoice.status).toBe('ISSUED');
      expect(invoice.totalAmount).toBe(invoiceTotal);
      expect(invoice.currency).toBe('NGN');
      expect(invoice.invoiceNumber).toMatch(/^INV-/);
      invoiceId = invoice.id;
    });

    it('shows the flight in a single line item on the invoice detail', async () => {
      const res = await request(server)
        .get(`/api/v1/invoices/me/${invoiceId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.data.lineItems).toHaveLength(1);
      expect(res.body.data.lineItems[0].amount).toBe(invoiceTotal);
      expect(res.body.data.payments).toHaveLength(0);
    });
  });

  describe('cross-customer boundaries', () => {
    const emailA = `${RUN_ID}.customerA@example.com`;
    const emailB = `${RUN_ID}.customerB@example.com`;
    let tokenA: string;
    let tokenB: string;
    let invoiceIdA: string;

    it('sets up two customers, one with a booking/invoice', async () => {
      tokenA = await registerAndLogin(server, emailA, 'A');
      tokenB = await registerAndLogin(server, emailB, 'B');

      const { bookingId } = await bookFlight(server, tokenA);
      const listRes = await request(server)
        .get('/api/v1/invoices/me')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      invoiceIdA = listRes.body.data.find(
        (inv: { flightBookingId: string }) => inv.flightBookingId === bookingId,
      ).id;
    });

    it("customer B cannot view customer A's invoice", async () => {
      await request(server)
        .get(`/api/v1/invoices/me/${invoiceIdA}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(403);
    });

    it('customer B is forbidden from the admin invoices list (lacks invoice:read)', async () => {
      await request(server)
        .get('/api/v1/invoices')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(403);
    });
  });

  describe('staff/finance permission boundaries + payment recording', () => {
    const staffEmail = `${RUN_ID}.staff@testtravel.example`;
    const branchManagerEmail = `${RUN_ID}.branchmgr@testtravel.example`;
    const financeEmail = `${RUN_ID}.finance@testtravel.example`;
    const customerEmail = `${RUN_ID}.payer@example.com`;
    let staffToken: string;
    let branchManagerToken: string;
    let financeToken: string;
    let customerToken: string;
    let invoiceId: string;
    let invoiceTotal: number;

    it('sets up a company, STAFF, BRANCH_MANAGER, and FINANCE_OFFICER', async () => {
      const companyRes = await request(server)
        .post('/api/v1/companies')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ name: `Payments Test Co ${RUN_ID}` })
        .expect(201);
      const companyId = companyRes.body.data.id;

      const rolesRes = await request(server)
        .get('/api/v1/rbac/roles')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);
      const roleId = (name: string): string =>
        (rolesRes.body.data as Array<{ id: string; name: string }>).find(
          (r) => r.name === name,
        )!.id;

      for (const [email, roleName, code] of [
        [staffEmail, 'STAFF', 'ST'],
        [branchManagerEmail, 'BRANCH_MANAGER', 'BM'],
        [financeEmail, 'FINANCE_OFFICER', 'FO'],
      ] as const) {
        const createRes = await request(server)
          .post('/api/v1/staff')
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send({
            email,
            firstName: roleName,
            lastName: 'Member',
            companyId,
            employeeCode: `${code}-${RUN_ID}`,
            roleId: roleId(roleName),
          })
          .expect(201);
        const loginRes = await request(server).post('/api/v1/auth/login').send({
          email,
          password: createRes.body.data.temporaryPassword,
        });
        if (roleName === 'STAFF') staffToken = loginRes.body.data.accessToken;
        if (roleName === 'BRANCH_MANAGER')
          branchManagerToken = loginRes.body.data.accessToken;
        if (roleName === 'FINANCE_OFFICER')
          financeToken = loginRes.body.data.accessToken;
      }

      customerToken = await registerAndLogin(server, customerEmail, 'Payer');
      const { bookingId, invoiceTotal: total } = await bookFlight(
        server,
        customerToken,
      );
      invoiceTotal = total;
      const listRes = await request(server)
        .get('/api/v1/invoices')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);
      invoiceId = listRes.body.data.find(
        (inv: { flightBookingId: string }) => inv.flightBookingId === bookingId,
      ).id;
    });

    it('STAFF and BRANCH_MANAGER can read invoices but not record payments', async () => {
      for (const token of [staffToken, branchManagerToken]) {
        await request(server)
          .get('/api/v1/invoices')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);
        await request(server)
          .get(`/api/v1/invoices/${invoiceId}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200);
        await request(server)
          .post(`/api/v1/invoices/${invoiceId}/payments`)
          .set('Authorization', `Bearer ${token}`)
          .send({ amount: 1000, method: 'CASH' })
          .expect(403);
      }
    });

    it('rejects a payment that exceeds the outstanding balance', async () => {
      await request(server)
        .post(`/api/v1/invoices/${invoiceId}/payments`)
        .set('Authorization', `Bearer ${financeToken}`)
        .send({ amount: invoiceTotal + 1, method: 'CASH' })
        .expect(400);
    });

    it('FINANCE_OFFICER records a partial payment, moving the invoice to PARTIALLY_PAID', async () => {
      const partial = Math.floor(invoiceTotal / 2);
      const res = await request(server)
        .post(`/api/v1/invoices/${invoiceId}/payments`)
        .set('Authorization', `Bearer ${financeToken}`)
        .send({ amount: partial, method: 'BANK_TRANSFER', note: 'deposit' })
        .expect(201);

      expect(res.body.data.status).toBe('PARTIALLY_PAID');
      expect(res.body.data.payments).toHaveLength(1);
    });

    it('records the remaining balance, moving the invoice to PAID', async () => {
      const detailRes = await request(server)
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(200);
      const paidSoFar = detailRes.body.data.payments.reduce(
        (sum: number, p: { amount: number }) => sum + p.amount,
        0,
      );
      const remaining = invoiceTotal - paidSoFar;

      const res = await request(server)
        .post(`/api/v1/invoices/${invoiceId}/payments`)
        .set('Authorization', `Bearer ${financeToken}`)
        .send({ amount: remaining, method: 'CASH' })
        .expect(201);

      expect(res.body.data.status).toBe('PAID');
    });

    it('rejects any further payment against a fully-paid invoice', async () => {
      await request(server)
        .post(`/api/v1/invoices/${invoiceId}/payments`)
        .set('Authorization', `Bearer ${financeToken}`)
        .send({ amount: 1, method: 'CASH' })
        .expect(409);
    });
  });

  describe('cancellation voids an unpaid invoice but not a paid one', () => {
    const emailUnpaid = `${RUN_ID}.unpaid@example.com`;
    const emailPaid = `${RUN_ID}.paidup@example.com`;

    it('voids the invoice when the underlying booking is cancelled unpaid', async () => {
      const token = await registerAndLogin(server, emailUnpaid, 'Unpaid');
      const { bookingId } = await bookFlight(server, token);

      await request(server)
        .post(`/api/v1/flights/bookings/me/${bookingId}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const listRes = await request(server)
        .get('/api/v1/invoices/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const invoice = listRes.body.data.find(
        (inv: { flightBookingId: string }) => inv.flightBookingId === bookingId,
      );
      expect(invoice.status).toBe('VOID');
    });

    it('leaves a fully-paid invoice untouched when its booking is cancelled', async () => {
      const token = await registerAndLogin(server, emailPaid, 'Paidup');
      const { bookingId, invoiceTotal } = await bookFlight(server, token);

      const listRes = await request(server)
        .get('/api/v1/invoices/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const invoiceId = listRes.body.data.find(
        (inv: { flightBookingId: string }) => inv.flightBookingId === bookingId,
      ).id;

      await request(server)
        .post(`/api/v1/invoices/${invoiceId}/payments`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ amount: invoiceTotal, method: 'CARD' })
        .expect(201);

      await request(server)
        .post(`/api/v1/flights/bookings/me/${bookingId}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const detailRes = await request(server)
        .get(`/api/v1/invoices/me/${invoiceId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(detailRes.body.data.status).toBe('PAID');
    });
  });

  describe('admin invoice list filtering', () => {
    it('filters the admin list by status', async () => {
      const res = await request(server)
        .get('/api/v1/invoices?status=PAID')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(
        res.body.data.every((inv: { status: string }) => inv.status === 'PAID'),
      ).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });
  });
});
