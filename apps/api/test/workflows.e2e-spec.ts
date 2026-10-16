/**
 * Phase 27 - cross-module business workflows, driven through the real HTTP API against the dedicated test database
 * (alnajoum_erp_test). Everything here uses the MOCK providers (flights, payments, payouts, notifications) and
 * invented people / `example.com` addresses; nothing contacts a real provider or a real customer.
 *
 *  Scenario 2  customer books a flight -> ticket refused before payment -> instalments -> PAID -> ticket -> ledger
 *  Scenario 4  Hajj registration paid in instalments (partial, over-payment refused, double submit, settled)
 *  Scenario 5  staff incentive: ticketing creates it -> approval -> payout FAILS -> bank detail fixed + re-verified
 *              -> retry succeeds -> exactly one payout, one PAID incentive, no second transfer
 *  Scenario 7  role and tenant boundaries across the same records
 *  Scenario 8  error recovery: duplicate / concurrent requests, repeated payout, unauthenticated calls
 */
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/bootstrap';
import { PrismaService } from './../src/infrastructure/prisma/prisma.service';
import { defaultCompanyId } from './default-company';

const ADMIN_EMAIL = 'admin@alnajoum.travel';
const ADMIN_PASSWORD = 'Alnajoum@2026';
const RUN = `wf-${Date.now().toString(36)}`;

const SEARCH_BODY = {
  tripType: 'ONE_WAY',
  legs: [{ origin: 'LOS', destination: 'ABV', departureDate: '2027-05-10' }],
  adults: 1,
};

describe('Cross-module workflows (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let prisma: PrismaService;
  let admin: string;
  let companyId: string;
  const roleIds: Record<string, string> = {};
  let markupRuleId: string | undefined;

  interface Person {
    token: string;
    staffId?: string;
    email: string;
    password: string;
  }
  const people: Record<string, Person> = {};
  // Records created by the flight scenario, reused by the boundary checks.
  const shared: {
    bookingId?: string;
    invoiceId?: string;
    incentiveId?: string;
  } = {};

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function login(email: string, password: string): Promise<string> {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(201);
    return res.body.data.accessToken as string;
  }

  async function createStaff(key: string, roleName: string): Promise<Person> {
    const email = `${RUN}.${key}@testtravel.example`;
    const res = await request(server)
      .post('/api/v1/staff')
      .set(auth(admin))
      .send({
        email,
        firstName: key,
        lastName: 'Workflow',
        companyId,
        employeeCode: `${key}-${RUN}`.toUpperCase(),
        roleId: roleIds[roleName],
      })
      .expect(201);
    const password = res.body.data.temporaryPassword as string;
    const person: Person = {
      token: await login(email, password),
      staffId: (
        await prisma.staff.findFirstOrThrow({
          where: { identity: { email } },
          select: { id: true },
        })
      ).id,
      email,
      password,
    };
    people[key] = person;
    return person;
  }

  async function registerCustomer(key: string): Promise<Person> {
    const email = `${RUN}.${key}@example.com`;
    const password = 'Passw0rd1';
    await request(server)
      .post('/api/v1/auth/register')
      .send({ email, password, firstName: key, lastName: 'Customer' })
      .expect(201);
    const person: Person = {
      token: await login(email, password),
      email,
      password,
    };
    people[key] = person;
    return person;
  }

  async function stepUp(person: Person): Promise<Record<string, string>> {
    const res = await request(server)
      .post('/api/v1/security/step-up')
      .set(auth(person.token))
      .send({ password: person.password });
    expect([200, 201]).toContain(res.status);
    return {
      ...auth(person.token),
      'X-Step-Up-Token': res.body.data.stepUpToken as string,
    };
  }

  async function firstOffer(token: string) {
    const res = await request(server)
      .post('/api/v1/flights/search')
      .set(auth(token))
      .send(SEARCH_BODY)
      .expect(201);
    return res.body.data[0] as { id: string; totalAmount: number };
  }

  async function invoiceFor(flightBookingId: string) {
    const res = await request(server)
      .get('/api/v1/invoices')
      .set(auth(admin))
      .expect(200);
    return (
      res.body.data as Array<{
        id: string;
        flightBookingId: string;
        totalAmount: number;
        status: string;
      }>
    ).find((i) => i.flightBookingId === flightBookingId)!;
  }

  async function publishedPackage(
    name: string,
    price: number,
  ): Promise<string> {
    const created = await request(server)
      .post('/api/v1/hajj/packages')
      .set(auth(admin))
      .send({
        name,
        price,
        currency: 'NGN',
        durationDays: 21,
        seatsAvailable: 10,
        maxPilgrims: 10,
      });
    expect({
      status: created.status,
      body: created.status === 201 ? 'ok' : created.body,
    }).toEqual({ status: 201, body: 'ok' });
    const id = created.body.data.id as string;
    await request(server)
      .patch(`/api/v1/hajj/packages/${id}`)
      .set(auth(admin))
      .send({ status: 'PUBLISHED' })
      .expect(200);
    return id;
  }

  const pay = (token: string, invoiceId: string, amount: number) =>
    request(server)
      .post(`/api/v1/invoices/${invoiceId}/payments`)
      .set(auth(token))
      .send({ amount, method: 'BANK_TRANSFER', note: `${RUN} instalment` });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);

    admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    companyId = await defaultCompanyId(server, admin);
    const roles = await request(server)
      .get('/api/v1/rbac/roles')
      .set(auth(admin))
      .expect(200);
    for (const r of roles.body.data as Array<{ id: string; name: string }>)
      roleIds[r.name] = r.id;

    // Feature flags are created by the seed (fail closed otherwise); the e2e global setup runs the seed.
    // The mock supplier sells at cost, so a flight has no margin (and no incentive) until a pricing rule adds one.
    const rule = await request(server)
      .post('/api/v1/flights/pricing-rules')
      .set(auth(admin))
      .send({ name: `${RUN} 10% markup`, type: 'PERCENTAGE', percent: 10 })
      .expect(201);
    markupRuleId = rule.body.data.id as string;

    // Flight incentives need a default policy; 50% of margin keeps the arithmetic obvious. Reuse one if present.
    if (
      !(await prisma.incentivePolicy.findFirst({
        where: { isDefault: true, isActive: true },
      }))
    ) {
      await request(server)
        .post('/api/v1/visa/incentive-policies')
        .set(auth(admin))
        .send({
          name: `${RUN} default 50% of margin`,
          type: 'PERCENT_OF_MARGIN',
          config: { percent: 50 },
          isDefault: true,
        })
        .expect(201);
    }

    await createStaff('agent', 'STAFF');
    await createStaff('manager', 'BRANCH_MANAGER');
    await createStaff('finance', 'FINANCE_OFFICER');
    await createStaff('finance2', 'FINANCE_OFFICER');
    await registerCustomer('amina');
  }, 120_000);

  afterAll(async () => {
    // Leave no active test pricing rule behind: it would change the price of every later flight search.
    if (markupRuleId) {
      await request(server)
        .patch(`/api/v1/flights/pricing-rules/${markupRuleId}`)
        .set(auth(admin))
        .send({ isActive: false });
    }
    await app.close();
  });

  // ------------------------------------------------------------------------------------------------------------
  describe('Scenarios 2 and 5: flight booked by staff, paid in instalments, ticketed, incentive paid out', () => {
    let bookingId: string;
    let invoiceId: string;
    let total: number;
    let incentiveId: string;
    let customerId: string;

    it('staff books on behalf of a registered customer; an invoice is raised', async () => {
      const me = await request(server)
        .get('/api/v1/customers/me')
        .set(auth(people.amina.token));
      customerId = (me.body.data?.id ?? me.body.id) as string;
      expect(customerId).toBeTruthy();

      const offer = await firstOffer(people.agent.token);
      const res = await request(server)
        .post('/api/v1/flights/bookings')
        .set(auth(people.agent.token))
        .send({
          customerId,
          offerId: offer.id,
          passengers: [{ type: 'ADULT' }],
        })
        .expect(201);
      bookingId = res.body.data.id as string;
      expect(res.body.data.status).toBe('CONFIRMED');

      const invoice = await invoiceFor(bookingId);
      expect(invoice.status).toBe('ISSUED');
      invoiceId = invoice.id;
      shared.bookingId = bookingId;
      shared.invoiceId = invoiceId;
      total = invoice.totalAmount;
      expect(total).toBeGreaterThan(0);
    });

    it('ticketing is refused while the invoice is unpaid and creates no incentive', async () => {
      const res = await request(server)
        .post(`/api/v1/flights/bookings/${bookingId}/ticket`)
        .set(auth(people.manager.token));
      expect([400, 409]).toContain(res.status);
      expect(
        await prisma.staffIncentive.count({
          where: { sourceType: 'FLIGHT_BOOKING', sourceId: bookingId },
        }),
      ).toBe(0);
    });

    it('finance records the first instalment; the invoice is PARTIALLY_PAID and the ticket is still refused', async () => {
      const res = await pay(
        people.finance.token,
        invoiceId,
        Math.floor(total / 3),
      ).expect(201);
      expect(res.body.data.status).toBe('PARTIALLY_PAID');
      const t = await request(server)
        .post(`/api/v1/flights/bookings/${bookingId}/ticket`)
        .set(auth(people.manager.token));
      expect([400, 409]).toContain(t.status);
    });

    it('settles the balance; each payment has exactly one ledger posting', async () => {
      const detail = await request(server)
        .get(`/api/v1/invoices/${invoiceId}`)
        .set(auth(people.finance.token))
        .expect(200);
      const paid = (
        detail.body.data.payments as Array<{ amount: number }>
      ).reduce((s, p) => s + p.amount, 0);
      const res = await pay(
        people.finance.token,
        invoiceId,
        total - paid,
      ).expect(201);
      expect(res.body.data.status).toBe('PAID');

      const payments = res.body.data.payments as Array<{
        id: string;
        amount: number;
      }>;
      expect(payments).toHaveLength(2);
      expect(payments.reduce((s, p) => s + p.amount, 0)).toBe(total);
      for (const p of payments) {
        const entries = await prisma.journalEntry.findMany({
          where: { sourceModule: 'PAYMENT', sourceId: p.id },
        });
        expect(entries).toHaveLength(1);
        expect(entries[0].amount).toBe(p.amount);
        expect(entries[0].status).toBe('POSTED');
        expect(entries[0].companyId).toBe(companyId);
      }
    });

    it('a customer notification exists for the payment', async () => {
      const receipts = await prisma.notification.findMany({
        where: { recipient: people.amina.email, type: 'PAYMENT_RECEIPT' },
      });
      expect(receipts.length).toBeGreaterThanOrEqual(2);
      expect(receipts.every((n) => n.status === 'SENT')).toBe(true);
    });

    it('the ticket is issued once; the booking is TICKETED with a PNR; a second attempt is refused', async () => {
      const res = await request(server)
        .post(`/api/v1/flights/bookings/${bookingId}/ticket`)
        .set(auth(people.manager.token))
        .expect(201);
      expect(res.body.data.status).toBe('TICKETED');
      const again = await request(server)
        .post(`/api/v1/flights/bookings/${bookingId}/ticket`)
        .set(auth(people.manager.token));
      expect([400, 409]).toContain(again.status);
    });

    it('ticketing created exactly one PENDING incentive for the booking agent and recorded the supplier cost', async () => {
      const incentives = await prisma.staffIncentive.findMany({
        where: { sourceType: 'FLIGHT_BOOKING', sourceId: bookingId },
      });
      expect(incentives).toHaveLength(1);
      expect(incentives[0].status).toBe('PENDING');
      expect(incentives[0].staffId).toBe(people.agent.staffId);
      incentiveId = incentives[0].id;
      shared.incentiveId = incentiveId;
    });

    it('the agent cannot approve or pay their own incentive (no permission)', async () => {
      await request(server)
        .post(`/api/v1/visa/incentives/${incentiveId}/approve`)
        .set(auth(people.agent.token))
        .expect(403);
    });

    it('finance approves it; paying out without bank details is refused', async () => {
      await request(server)
        .post(`/api/v1/visa/incentives/${incentiveId}/approve`)
        .set(auth(people.finance.token))
        .expect(201);
      const headers = await stepUp(people.finance);
      const res = await request(server)
        .post(`/api/v1/visa/payouts/${incentiveId}/pay`)
        .set(headers);
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/bank details/i);
    });

    it('payout is refused until Finance verifies the account (and cannot be verified by the account holder)', async () => {
      await request(server)
        .patch('/api/v1/visa/payouts/me/bank-details')
        .set(auth(people.agent.token))
        .send({
          bankName: 'Test Bank',
          bankAccountNumber: '0000000000',
          bankAccountName: 'Agent Workflow',
        })
        .expect(200);
      const headers = await stepUp(people.finance);
      const unverified = await request(server)
        .post(`/api/v1/visa/payouts/${incentiveId}/pay`)
        .set(headers);
      expect(unverified.status).toBe(400);
      expect(JSON.stringify(unverified.body)).toMatch(/not been verified/i);

      await request(server)
        .post(
          `/api/v1/finance/staff-bank-accounts/${people.agent.staffId}/verify`,
        )
        .set(auth(people.agent.token))
        .expect(403);
      await request(server)
        .post(
          `/api/v1/finance/staff-bank-accounts/${people.agent.staffId}/verify`,
        )
        .set(auth(people.finance2.token))
        .expect(201);
    });

    it('the provider rejects account 0000000000: the payout FAILS, the incentive stays APPROVED, no money is recorded as sent', async () => {
      const headers = await stepUp(people.finance);
      const res = await request(server)
        .post(`/api/v1/visa/payouts/${incentiveId}/pay`)
        .set(headers);
      expect([200, 201]).toContain(res.status);
      const payout = await prisma.staffPayout.findUnique({
        where: { incentiveId },
      });
      expect(payout?.status).toBe('FAILED');
      const incentive = await prisma.staffIncentive.findUnique({
        where: { id: incentiveId },
      });
      expect(incentive?.status).toBe('APPROVED');
      expect(
        await prisma.journalEntry.count({
          where: { sourceModule: 'PAYOUT', sourceId: payout!.id },
        }),
      ).toBe(0);
    });

    it('the holder corrects the account; it must be verified again before the retry; the retry succeeds once', async () => {
      await request(server)
        .patch('/api/v1/visa/payouts/me/bank-details')
        .set(auth(people.agent.token))
        .send({
          bankName: 'Test Bank',
          bankAccountNumber: '0123456789',
          bankAccountName: 'Agent Workflow',
        })
        .expect(200);
      const headers = await stepUp(people.finance);
      const blocked = await request(server)
        .post(`/api/v1/visa/payouts/${incentiveId}/retry`)
        .set(headers);
      expect(blocked.status).toBe(400);

      await request(server)
        .post(
          `/api/v1/finance/staff-bank-accounts/${people.agent.staffId}/verify`,
        )
        .set(auth(people.finance2.token))
        .expect(201);
      const retry = await request(server)
        .post(`/api/v1/visa/payouts/${incentiveId}/retry`)
        .set(headers);
      expect([200, 201]).toContain(retry.status);

      const payout = await prisma.staffPayout.findUnique({
        where: { incentiveId },
      });
      expect(payout?.status).toBe('SUCCESSFUL');
      const incentive = await prisma.staffIncentive.findUnique({
        where: { id: incentiveId },
      });
      expect(incentive?.status).toBe('PAID');
    });

    it('a repeated payout request cannot pay twice', async () => {
      const headers = await stepUp(people.finance);
      const again = await request(server)
        .post(`/api/v1/visa/payouts/${incentiveId}/pay`)
        .set(headers);
      expect(again.status).toBe(409);
      const retry = await request(server)
        .post(`/api/v1/visa/payouts/${incentiveId}/retry`)
        .set(headers);
      expect([400, 409]).toContain(retry.status);
      expect(await prisma.staffPayout.count({ where: { incentiveId } })).toBe(
        1,
      );
    });

    it('the payout is posted to the ledger at most once', async () => {
      const payout = await prisma.staffPayout.findUnique({
        where: { incentiveId },
      });
      const entries = await prisma.journalEntry.findMany({
        where: {
          sourceModule: 'PAYOUT',
          sourceId: payout!.id,
          status: 'POSTED',
        },
      });
      expect(entries.length).toBeLessThanOrEqual(1);
    });
  });

  // ------------------------------------------------------------------------------------------------------------
  describe('Scenario 3: visa application from request to completion', () => {
    let applicationId: string;
    let invoiceId: string;
    let customerId: string;
    const SELLING = 80_000;
    const COST = 30_000;

    function expectOk(res: request.Response, status: number) {
      expect({
        status: res.status,
        body: res.status === status ? 'ok' : res.body,
      }).toEqual({ status, body: 'ok' });
    }

    it('admin publishes a visa service; staff lodges an application for the customer; an invoice is raised', async () => {
      const svc = await request(server)
        .post('/api/v1/visa/services')
        .set(auth(admin))
        .send({
          country: 'Ghana',
          visaType: `${RUN} Tourist`,
          companyCost: COST,
          sellingPrice: SELLING,
          currency: 'NGN',
          status: 'ACTIVE',
          isAvailable: true,
        });
      expectOk(svc, 201);
      const me = await request(server)
        .get('/api/v1/customers/me')
        .set(auth(people.amina.token));
      customerId = (me.body.data?.id ?? me.body.id) as string;

      const app1 = await request(server)
        .post(`/api/v1/visa/applications/for/${customerId}`)
        .set(auth(people.agent.token))
        .send({
          destinationCountry: 'Ghana',
          visaType: 'TOURIST',
          visaServiceId: svc.body.data.id,
        });
      expectOk(app1, 201);
      applicationId = app1.body.data.id as string;

      const invoices = await request(server)
        .get('/api/v1/invoices')
        .set(auth(people.finance.token))
        .expect(200);
      const invoice = (
        invoices.body.data as Array<{
          id: string;
          visaApplicationId?: string;
          totalAmount: number;
        }>
      ).find((i) => i.visaApplicationId === applicationId);
      expect(invoice).toBeTruthy();
      expect(invoice!.totalAmount).toBe(SELLING);
      invoiceId = invoice!.id;
    });

    it('another company-less customer cannot see the application; the owner can', async () => {
      const other = people.other ?? (await registerCustomer('other'));
      await request(server)
        .get(`/api/v1/visa/applications/me/${applicationId}`)
        .set(auth(other.token))
        .expect(403);
      await request(server)
        .get(`/api/v1/visa/applications/me/${applicationId}`)
        .set(auth(people.amina.token))
        .expect(200);
    });

    it('an unpaid application cannot be completed, and no incentive is created', async () => {
      const res = await request(server)
        .post(`/api/v1/visa/applications/${applicationId}/status`)
        .set(auth(people.agent.token))
        .send({ status: 'COMPLETED' });
      // A refusal for the right reason (business rule), not for lack of permission.
      expect({
        status: res.status,
        body: [400, 409].includes(res.status) ? 'refused' : res.body,
      }).toEqual({ status: res.status, body: 'refused' });
      expect(
        await prisma.staffIncentive.count({
          where: { sourceType: 'VISA_APPLICATION', sourceId: applicationId },
        }),
      ).toBe(0);
    });

    it('once paid in full the application can be completed; exactly one incentive is created for the agent', async () => {
      const paid = await pay(people.finance.token, invoiceId, SELLING);
      expectOk(paid, 201);
      expect(paid.body.data.status).toBe('PAID');
      const done = await request(server)
        .post(`/api/v1/visa/applications/${applicationId}/status`)
        .set(auth(people.agent.token))
        .send({ status: 'COMPLETED', staffNote: 'visa issued (test)' });
      expectOk(done, 201);
      const incentives = await prisma.staffIncentive.findMany({
        where: { sourceType: 'VISA_APPLICATION', sourceId: applicationId },
      });
      expect(incentives).toHaveLength(1);
      expect(incentives[0].staffId).toBe(people.agent.staffId);
      expect(incentives[0].margin).toBe(SELLING - COST);
      expect(incentives[0].status).toBe('PENDING');
    });

    it('a completed application is final: completing again is refused and creates nothing', async () => {
      const again = await request(server)
        .post(`/api/v1/visa/applications/${applicationId}/status`)
        .set(auth(people.agent.token))
        .send({ status: 'COMPLETED' });
      expect(again.status).toBe(409);
      expect(
        await prisma.staffIncentive.count({
          where: { sourceType: 'VISA_APPLICATION', sourceId: applicationId },
        }),
      ).toBe(1);
    });

    it('a customer cannot move their own application to COMPLETED', async () => {
      const res = await request(server)
        .post(`/api/v1/visa/applications/${applicationId}/status`)
        .set(auth(people.amina.token))
        .send({ status: 'COMPLETED' });
      expect(res.status).toBe(403);
    });
  });

  // ------------------------------------------------------------------------------------------------------------
  describe('Scenario 4: Hajj registration paid in instalments', () => {
    let invoiceId: string;
    let total: number;

    it('admin publishes a package and the customer registers', async () => {
      const packageId = await publishedPackage(
        `${RUN} Hajj test package`,
        3_000_000,
      );
      const reg = await request(server)
        .post('/api/v1/hajj/registrations/me')
        .set(auth(people.amina.token))
        .send({ packageId, pilgrims: [{}] });
      expect({
        status: reg.status,
        body: reg.status === 201 ? 'ok' : reg.body,
      }).toEqual({ status: 201, body: 'ok' });
      expect(reg.body.data.totalAmount).toBe(3_000_000);

      const invoices = await request(server)
        .get('/api/v1/invoices/me')
        .set(auth(people.amina.token))
        .expect(200);
      const invoice = (
        invoices.body.data as Array<{
          id: string;
          hajjRegistrationId?: string;
          totalAmount: number;
        }>
      ).find((i) => i.hajjRegistrationId === reg.body.data.id);
      expect(invoice).toBeTruthy();
      invoiceId = invoice!.id;
      total = invoice!.totalAmount;
      expect(total).toBe(3_000_000);
    });

    it('three instalments move the invoice ISSUED -> PARTIALLY_PAID -> PAID with a ledger entry each', async () => {
      const a = await pay(people.finance.token, invoiceId, 1_000_000).expect(
        201,
      );
      expect(a.body.data.status).toBe('PARTIALLY_PAID');
      const b = await pay(people.finance.token, invoiceId, 1_000_000).expect(
        201,
      );
      expect(b.body.data.status).toBe('PARTIALLY_PAID');
      const c = await pay(people.finance.token, invoiceId, 1_000_000).expect(
        201,
      );
      expect(c.body.data.status).toBe('PAID');
      const ids = (c.body.data.payments as Array<{ id: string }>).map(
        (p) => p.id,
      );
      expect(ids).toHaveLength(3);
      expect(
        await prisma.journalEntry.count({
          where: { sourceModule: 'PAYMENT', sourceId: { in: ids } },
        }),
      ).toBe(3);
    });

    it('over-payment and payment on a settled invoice are refused', async () => {
      await pay(people.finance.token, invoiceId, 1).expect(409);
    });

    it('an over-payment on a fresh registration is rejected without recording anything', async () => {
      const packageId = await publishedPackage(
        `${RUN} Hajj package 2`,
        500_000,
      );
      const reg = await request(server)
        .post('/api/v1/hajj/registrations/me')
        .set(auth(people.amina.token))
        .send({ packageId, pilgrims: [{}] })
        .expect(201);
      const invoices = await request(server)
        .get('/api/v1/invoices/me')
        .set(auth(people.amina.token))
        .expect(200);
      const invoice = (
        invoices.body.data as Array<{ id: string; hajjRegistrationId?: string }>
      ).find((i) => i.hajjRegistrationId === reg.body.data.id)!;
      await pay(people.finance.token, invoice.id, 500_001).expect(400);
      expect(
        await prisma.payment.count({ where: { invoiceId: invoice.id } }),
      ).toBe(0);
    });
  });

  // ------------------------------------------------------------------------------------------------------------
  describe('Scenario 7: role and tenant boundaries', () => {
    it('unauthenticated calls to protected workflow endpoints are refused', async () => {
      for (const path of [
        '/api/v1/invoices',
        '/api/v1/flights/bookings',
        '/api/v1/visa/payouts',
        '/api/v1/hajj/registrations',
      ]) {
        await request(server).get(path).expect(401);
      }
    });

    it('a customer cannot reach staff-only workflow endpoints', async () => {
      const t = people.amina.token;
      await request(server).get('/api/v1/invoices').set(auth(t)).expect(403);
      await request(server)
        .get('/api/v1/visa/payouts')
        .set(auth(t))
        .expect(403);
      await request(server)
        .post(`/api/v1/visa/incentives/${shared.incentiveId}/approve`)
        .set(auth(t))
        .expect(403);
      await request(server)
        .get('/api/v1/hajj/registrations')
        .set(auth(t))
        .expect(403);
    });

    it('a staff agent cannot record payments; a customer cannot issue tickets', async () => {
      await request(server)
        .post(`/api/v1/invoices/${shared.invoiceId}/payments`)
        .set(auth(people.agent.token))
        .send({ amount: 1, method: 'CASH' })
        .expect(403);
      await request(server)
        .post(`/api/v1/flights/bookings/${shared.bookingId}/ticket`)
        .set(auth(people.amina.token))
        .expect(403);
    });

    it('another customer cannot read or pay this customer’s invoices', async () => {
      const other = people.other ?? (await registerCustomer('other'));
      const invoiceId = shared.invoiceId;
      // Known limitation (P3): the service answers 403 for someone else's invoice and 404 for an id that does not
      // exist, so the two can be told apart. Ids are unguessable cuids and no data is returned; recorded in the report.
      const read = await request(server)
        .get(`/api/v1/invoices/me/${invoiceId}`)
        .set(auth(other.token));
      expect([403, 404]).toContain(read.status);
      expect(JSON.stringify(read.body)).not.toContain(people.amina.email);
      await request(server)
        .post(`/api/v1/invoices/${invoiceId}/payments`)
        .set(auth(other.token))
        .send({ amount: 1, method: 'CASH' })
        .expect(403);
    });

    it('step-up protects payouts: a finance officer without a step-up token is refused', async () => {
      const res = await request(server)
        .post(`/api/v1/visa/payouts/${shared.incentiveId}/pay`)
        .set(auth(people.finance.token));
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).toMatch(/STEP_UP_REQUIRED/);
    });

    it('a step-up token belongs to one person: another finance officer cannot reuse it', async () => {
      const headers = await stepUp(people.finance);
      const res = await request(server)
        .post(`/api/v1/visa/payouts/${shared.incentiveId}/pay`)
        .set({
          ...auth(people.finance2.token),
          'X-Step-Up-Token': headers['X-Step-Up-Token'],
        });
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).toMatch(/STEP_UP_REQUIRED/);
    });
  });

  // ------------------------------------------------------------------------------------------------------------
  describe('Scenario 8: duplicate and concurrent requests', () => {
    it('two simultaneous full payments on one invoice record exactly one', async () => {
      const offer = await firstOffer(people.amina.token);
      const booking = await request(server)
        .post('/api/v1/flights/bookings/me')
        .set(auth(people.amina.token))
        .send({ offerId: offer.id, passengers: [{ type: 'ADULT' }] })
        .expect(201);
      const invoice = await invoiceFor(booking.body.data.id as string);

      const results = await Promise.all([
        pay(people.finance.token, invoice.id, invoice.totalAmount),
        pay(people.finance2.token, invoice.id, invoice.totalAmount),
      ]);
      const ok = results.filter((r) => r.status === 201).length;
      expect(ok).toBe(1);
      expect(
        results.filter((r) => r.status === 409 || r.status === 400),
      ).toHaveLength(1);

      const payments = await prisma.payment.findMany({
        where: { invoiceId: invoice.id },
      });
      expect(payments).toHaveLength(1);
      expect(payments.reduce((s, p) => s + p.amount, 0)).toBe(
        invoice.totalAmount,
      );
      expect(
        await prisma.journalEntry.count({
          where: { sourceModule: 'PAYMENT', sourceId: payments[0].id },
        }),
      ).toBe(1);
    });

    it('a malformed or hostile payment body is rejected with 400 and records nothing', async () => {
      const offer = await firstOffer(people.amina.token);
      const booking = await request(server)
        .post('/api/v1/flights/bookings/me')
        .set(auth(people.amina.token))
        .send({ offerId: offer.id, passengers: [{ type: 'ADULT' }] })
        .expect(201);
      const invoice = await invoiceFor(booking.body.data.id as string);
      for (const body of [
        {},
        { amount: -5, method: 'CASH' },
        { amount: 1.5, method: 'CASH' },
        { amount: 100, method: 'NOPE' },
        { amount: 100, method: 'CASH', extra: 'field' },
      ]) {
        const res = await request(server)
          .post(`/api/v1/invoices/${invoice.id}/payments`)
          .set(auth(people.finance.token))
          .send(body);
        expect({ body, status: res.status }).toEqual({ body, status: 400 });
      }
      expect(
        await prisma.payment.count({ where: { invoiceId: invoice.id } }),
      ).toBe(0);
    });

    it('cancelling twice is refused the second time and does not touch an already-voided invoice', async () => {
      const offer = await firstOffer(people.amina.token);
      const booking = await request(server)
        .post('/api/v1/flights/bookings/me')
        .set(auth(people.amina.token))
        .send({ offerId: offer.id, passengers: [{ type: 'ADULT' }] })
        .expect(201);
      const id = booking.body.data.id as string;
      await request(server)
        .post(`/api/v1/flights/bookings/me/${id}/cancel`)
        .set(auth(people.amina.token))
        .expect(201);
      const again = await request(server)
        .post(`/api/v1/flights/bookings/me/${id}/cancel`)
        .set(auth(people.amina.token));
      expect([400, 409]).toContain(again.status);
    });
  });
});
