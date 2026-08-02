import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/bootstrap';

const BOOTSTRAP_ADMIN_EMAIL = 'admin@alnajoum.travel';
const BOOTSTRAP_ADMIN_PASSWORD = 'Alnajoum@2026';

const RUN_ID = `flt-${Date.now().toString(36)}`;

const ONE_WAY_SEARCH_BODY = {
  tripType: 'ONE_WAY',
  legs: [{ origin: 'LOS', destination: 'ABV', departureDate: '2027-02-10' }],
  adults: 1,
};

function search(server: App, token: string, body: Record<string, unknown>) {
  return request(server)
    .post('/api/v1/flights/search')
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

async function searchAndGetOfferId(
  server: App,
  token: string,
  body: Record<string, unknown> = ONE_WAY_SEARCH_BODY,
): Promise<string> {
  const res = await search(server, token, body).expect(201);
  return res.body.data[0].id as string;
}

describe('Flight Booking (e2e)', () => {
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

  describe('search and offers', () => {
    it('rejects an unauthenticated search', async () => {
      await request(server)
        .post('/api/v1/flights/search')
        .send(ONE_WAY_SEARCH_BODY)
        .expect(401);
    });

    it('returns offers for an authenticated one-way search', async () => {
      const res = await search(
        server,
        adminAccessToken,
        ONE_WAY_SEARCH_BODY,
      ).expect(201);

      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0].legs).toHaveLength(1);
      expect(res.body.data[0].legs[0]).toEqual(
        expect.objectContaining({ origin: 'LOS', destination: 'ABV' }),
      );
    });

    it('returns both legs for a round-trip search', async () => {
      const res = await search(server, adminAccessToken, {
        tripType: 'ROUND_TRIP',
        legs: [
          { origin: 'LOS', destination: 'ABV', departureDate: '2027-02-10' },
          { origin: 'ABV', destination: 'LOS', departureDate: '2027-02-20' },
        ],
        adults: 1,
      }).expect(201);

      expect(res.body.data[0].legs).toHaveLength(2);
      expect(res.body.data[0].legs[0].destination).toBe('ABV');
      expect(res.body.data[0].legs[1].destination).toBe('LOS');
    });

    it('returns every leg in order for a multi-city search', async () => {
      const res = await search(server, adminAccessToken, {
        tripType: 'MULTI_CITY',
        legs: [
          { origin: 'LOS', destination: 'ABV', departureDate: '2027-02-10' },
          { origin: 'ABV', destination: 'KAN', departureDate: '2027-02-13' },
          { origin: 'KAN', destination: 'LOS', departureDate: '2027-02-17' },
        ],
        adults: 1,
      }).expect(201);

      expect(
        res.body.data[0].legs.map(
          (l: { origin: string; destination: string }) =>
            `${l.origin}-${l.destination}`,
        ),
      ).toEqual(['LOS-ABV', 'ABV-KAN', 'KAN-LOS']);
    });

    it('rejects a one-way search sent with 2 legs', async () => {
      await search(server, adminAccessToken, {
        tripType: 'ONE_WAY',
        legs: ONE_WAY_SEARCH_BODY.legs.concat(ONE_WAY_SEARCH_BODY.legs),
        adults: 1,
      }).expect(400);
    });

    it('rejects a round trip search sent with only 1 leg', async () => {
      await search(server, adminAccessToken, {
        tripType: 'ROUND_TRIP',
        legs: ONE_WAY_SEARCH_BODY.legs,
        adults: 1,
      }).expect(400);
    });

    it('fetches a single offer by id', async () => {
      const offerId = await searchAndGetOfferId(server, adminAccessToken);

      const res = await request(server)
        .get(`/api/v1/flights/offers/${offerId}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(res.body.data.id).toBe(offerId);
    });

    it('returns 404 for an unknown offer id', async () => {
      await request(server)
        .get('/api/v1/flights/offers/does-not-exist')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(404);
    });
  });

  describe('self-service booking lifecycle', () => {
    const email = `${RUN_ID}.customer@example.com`;
    let token: string;
    let bookingId: string;

    it('registers and logs the customer in', async () => {
      await request(server)
        .post('/api/v1/auth/register')
        .send({
          email,
          password: 'Passw0rd1',
          firstName: 'Amina',
          lastName: 'Bello',
        })
        .expect(201);

      token = (
        await request(server)
          .post('/api/v1/auth/login')
          .send({ email, password: 'Passw0rd1' })
      ).body.data.accessToken;
    });

    it('books a flight for self', async () => {
      const offerId = await searchAndGetOfferId(server, token);

      const res = await request(server)
        .post('/api/v1/flights/bookings/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ offerId, passengers: [{ type: 'ADULT' }] })
        .expect(201);

      expect(res.body.data.status).toBe('CONFIRMED');
      expect(res.body.data.bookingReference).toMatch(/^ANJ-/);
      expect(res.body.data.passengers).toHaveLength(1);
      expect(res.body.data.passengers[0].firstName).toBe('Amina');
      bookingId = res.body.data.id;
    });

    it('rejects booking against an expired/unknown offer', async () => {
      await request(server)
        .post('/api/v1/flights/bookings/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ offerId: 'does-not-exist', passengers: [{ type: 'ADULT' }] })
        .expect(404);
    });

    it('lists and fetches the booking', async () => {
      const listRes = await request(server)
        .get('/api/v1/flights/bookings/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(
        listRes.body.data.some((b: { id: string }) => b.id === bookingId),
      ).toBe(true);

      const getRes = await request(server)
        .get(`/api/v1/flights/bookings/me/${bookingId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(getRes.body.data.id).toBe(bookingId);
    });

    it('cancels the booking, then rejects cancelling it again', async () => {
      const res = await request(server)
        .post(`/api/v1/flights/bookings/me/${bookingId}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      expect(res.body.data.status).toBe('CANCELLED');

      await request(server)
        .post(`/api/v1/flights/bookings/me/${bookingId}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
    });
  });

  describe('multi-city booking', () => {
    const email = `${RUN_ID}.multicity-customer@example.com`;
    let token: string;

    it('books a 3-leg multi-city trip and derives summary fields from it', async () => {
      await request(server)
        .post('/api/v1/auth/register')
        .send({
          email,
          password: 'Passw0rd1',
          firstName: 'Chidi',
          lastName: 'Okafor',
        })
        .expect(201);
      token = (
        await request(server)
          .post('/api/v1/auth/login')
          .send({ email, password: 'Passw0rd1' })
      ).body.data.accessToken;

      const offerId = await searchAndGetOfferId(server, token, {
        tripType: 'MULTI_CITY',
        legs: [
          { origin: 'LOS', destination: 'ABV', departureDate: '2027-02-10' },
          { origin: 'ABV', destination: 'KAN', departureDate: '2027-02-13' },
          { origin: 'KAN', destination: 'LOS', departureDate: '2027-02-17' },
        ],
        adults: 1,
      });

      const res = await request(server)
        .post('/api/v1/flights/bookings/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ offerId, passengers: [{ type: 'ADULT' }] })
        .expect(201);

      expect(res.body.data.tripType).toBe('MULTI_CITY');
      expect(res.body.data.origin).toBe('LOS');
      expect(res.body.data.destination).toBe('LOS');
      expect(res.body.data.itinerary.legs).toHaveLength(3);
    });
  });

  describe('booking for a family member', () => {
    const email = `${RUN_ID}.family-customer@example.com`;
    let token: string;
    let familyMemberId: string;

    it('registers a customer and adds a family member', async () => {
      await request(server)
        .post('/api/v1/auth/register')
        .send({
          email,
          password: 'Passw0rd1',
          firstName: 'Kemi',
          lastName: 'A',
        })
        .expect(201);

      token = (
        await request(server)
          .post('/api/v1/auth/login')
          .send({ email, password: 'Passw0rd1' })
      ).body.data.accessToken;

      const res = await request(server)
        .post('/api/v1/customers/me/family-members')
        .set('Authorization', `Bearer ${token}`)
        .send({ relationship: 'CHILD', firstName: 'Zara', lastName: 'A' })
        .expect(201);
      familyMemberId = res.body.data.id;
    });

    it('books a flight with the customer and the family member as passengers', async () => {
      const offerId = await searchAndGetOfferId(server, token);

      const res = await request(server)
        .post('/api/v1/flights/bookings/me')
        .set('Authorization', `Bearer ${token}`)
        .send({
          offerId,
          passengers: [{ type: 'ADULT' }, { type: 'CHILD', familyMemberId }],
        })
        .expect(201);

      expect(res.body.data.passengers).toHaveLength(2);
      const childPassenger = res.body.data.passengers.find(
        (p: { type: string }) => p.type === 'CHILD',
      );
      expect(childPassenger.firstName).toBe('Zara');
      expect(childPassenger.familyMemberId).toBe(familyMemberId);
    });
  });

  describe('cross-customer access boundaries', () => {
    const emailA = `${RUN_ID}.customerA@example.com`;
    const emailB = `${RUN_ID}.customerB@example.com`;
    let tokenA: string;
    let tokenB: string;
    let bookingIdA: string;
    let familyMemberIdA: string;

    it('sets up two customers, one with a family member and a booking', async () => {
      for (const email of [emailA, emailB]) {
        await request(server)
          .post('/api/v1/auth/register')
          .send({ email, password: 'Passw0rd1', firstName: 'X', lastName: 'Y' })
          .expect(201);
      }
      tokenA = (
        await request(server)
          .post('/api/v1/auth/login')
          .send({ email: emailA, password: 'Passw0rd1' })
      ).body.data.accessToken;
      tokenB = (
        await request(server)
          .post('/api/v1/auth/login')
          .send({ email: emailB, password: 'Passw0rd1' })
      ).body.data.accessToken;

      const memberRes = await request(server)
        .post('/api/v1/customers/me/family-members')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ relationship: 'SPOUSE', firstName: 'Partner', lastName: 'A' })
        .expect(201);
      familyMemberIdA = memberRes.body.data.id;

      const offerId = await searchAndGetOfferId(server, tokenA);
      const bookingRes = await request(server)
        .post('/api/v1/flights/bookings/me')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ offerId, passengers: [{ type: 'ADULT' }] })
        .expect(201);
      bookingIdA = bookingRes.body.data.id;
    });

    it("customer B cannot view or cancel customer A's booking", async () => {
      await request(server)
        .get(`/api/v1/flights/bookings/me/${bookingIdA}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(403);

      await request(server)
        .post(`/api/v1/flights/bookings/me/${bookingIdA}/cancel`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(403);
    });

    it("customer B cannot book using customer A's family member", async () => {
      const offerId = await searchAndGetOfferId(server, tokenB);

      await request(server)
        .post('/api/v1/flights/bookings/me')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          offerId,
          passengers: [{ type: 'ADULT', familyMemberId: familyMemberIdA }],
        })
        .expect(403);
    });

    it('customer B is forbidden from the admin bookings list (lacks flight:read)', async () => {
      await request(server)
        .get('/api/v1/flights/bookings')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(403);
    });
  });

  describe('admin/staff booking on behalf of a customer + role boundaries', () => {
    const staffEmail = `${RUN_ID}.staff@testtravel.example`;
    const branchManagerEmail = `${RUN_ID}.branchmgr@testtravel.example`;
    const customerEmail = `${RUN_ID}.managed@example.com`;
    let companyId: string;
    let staffToken: string;
    let branchManagerToken: string;
    let customerId: string;
    let bookingId: string;

    it('sets up a company, a STAFF member, and a BRANCH_MANAGER', async () => {
      const companyRes = await request(server)
        .post('/api/v1/companies')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ name: `Flight Test Co ${RUN_ID}` })
        .expect(201);
      companyId = companyRes.body.data.id;

      const rolesRes = await request(server)
        .get('/api/v1/rbac/roles')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);
      const staffRoleId = rolesRes.body.data.find(
        (r: { name: string }) => r.name === 'STAFF',
      ).id;
      const branchManagerRoleId = rolesRes.body.data.find(
        (r: { name: string }) => r.name === 'BRANCH_MANAGER',
      ).id;

      const staffCreateRes = await request(server)
        .post('/api/v1/staff')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          email: staffEmail,
          firstName: 'Staff',
          lastName: 'Member',
          companyId,
          employeeCode: `ST-${RUN_ID}`,
          roleId: staffRoleId,
        })
        .expect(201);
      staffToken = (
        await request(server).post('/api/v1/auth/login').send({
          email: staffEmail,
          password: staffCreateRes.body.data.temporaryPassword,
        })
      ).body.data.accessToken;

      const bmCreateRes = await request(server)
        .post('/api/v1/staff')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          email: branchManagerEmail,
          firstName: 'Branch',
          lastName: 'Mgr',
          companyId,
          employeeCode: `BM-${RUN_ID}`,
          roleId: branchManagerRoleId,
        })
        .expect(201);
      branchManagerToken = (
        await request(server).post('/api/v1/auth/login').send({
          email: branchManagerEmail,
          password: bmCreateRes.body.data.temporaryPassword,
        })
      ).body.data.accessToken;
    });

    it('registers the customer to be booked for', async () => {
      await request(server)
        .post('/api/v1/auth/register')
        .send({
          email: customerEmail,
          password: 'Passw0rd1',
          firstName: 'Tunde',
          lastName: 'A',
        })
        .expect(201);

      const res = await request(server)
        .get('/api/v1/customers')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);
      customerId = res.body.data.find(
        (c: { identity: { email: string } }) =>
          c.identity.email === customerEmail,
      ).id;
    });

    it('staff (flight:book) can create a booking on behalf of the customer', async () => {
      const offerId = await searchAndGetOfferId(server, staffToken);

      const res = await request(server)
        .post('/api/v1/flights/bookings')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ customerId, offerId, passengers: [{ type: 'ADULT' }] })
        .expect(201);

      expect(res.body.data.customerId).toBe(customerId);
      expect(res.body.data.bookedByStaffId).toBeTruthy();
      bookingId = res.body.data.id;
    });

    it('branch manager (flight:read only) can list/view but not book or cancel', async () => {
      await request(server)
        .get('/api/v1/flights/bookings')
        .set('Authorization', `Bearer ${branchManagerToken}`)
        .expect(200);

      await request(server)
        .get(`/api/v1/flights/bookings/${bookingId}`)
        .set('Authorization', `Bearer ${branchManagerToken}`)
        .expect(200);

      const offerId = await searchAndGetOfferId(server, branchManagerToken);
      await request(server)
        .post('/api/v1/flights/bookings')
        .set('Authorization', `Bearer ${branchManagerToken}`)
        .send({ customerId, offerId, passengers: [{ type: 'ADULT' }] })
        .expect(403);

      await request(server)
        .post(`/api/v1/flights/bookings/${bookingId}/cancel`)
        .set('Authorization', `Bearer ${branchManagerToken}`)
        .expect(403);
    });

    it('staff (no flight:cancel) cannot cancel the admin-side booking', async () => {
      await request(server)
        .post(`/api/v1/flights/bookings/${bookingId}/cancel`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(403);
    });

    it('super admin can cancel the booking and filter the admin list by status', async () => {
      await request(server)
        .post(`/api/v1/flights/bookings/${bookingId}/cancel`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(201);

      const res = await request(server)
        .get(
          `/api/v1/flights/bookings?customerId=${customerId}&status=CANCELLED`,
        )
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);
      expect(
        res.body.data.some((b: { id: string }) => b.id === bookingId),
      ).toBe(true);
    });
  });
});
