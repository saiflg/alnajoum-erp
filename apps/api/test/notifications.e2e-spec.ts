import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/bootstrap';

const BOOTSTRAP_ADMIN_EMAIL = 'admin@alnajoum.travel';
const BOOTSTRAP_ADMIN_PASSWORD = 'Alnajoum@2026';

const RUN_ID = `notif-${Date.now().toString(36)}`;

const SEARCH_BODY = {
  tripType: 'ONE_WAY',
  legs: [{ origin: 'LOS', destination: 'ABV', departureDate: '2027-06-10' }],
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

async function findNotification(
  server: App,
  adminToken: string,
  type: string,
  recipient: string,
) {
  const res = await request(server)
    .get(`/api/v1/notifications?type=${type}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(200);
  return (res.body.data as Array<{ recipient: string }>).find(
    (n) => n.recipient === recipient,
  );
}

describe('Notifications (e2e)', () => {
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

  describe('staff creation sends a temp-password notification', () => {
    const staffEmail = `${RUN_ID}.staff@testtravel.example`;
    let companyId: string;

    it('creates a company and a staff member', async () => {
      const companyRes = await request(server)
        .post('/api/v1/companies')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ name: `Notifications Test Co ${RUN_ID}` })
        .expect(201);
      companyId = companyRes.body.data.id;

      const rolesRes = await request(server)
        .get('/api/v1/rbac/roles')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);
      const staffRoleId = (
        rolesRes.body.data as Array<{ id: string; name: string }>
      ).find((r) => r.name === 'STAFF')!.id;

      await request(server)
        .post('/api/v1/staff')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          email: staffEmail,
          firstName: 'Notify',
          lastName: 'Staff',
          companyId,
          employeeCode: `ST-${RUN_ID}`,
          roleId: staffRoleId,
        })
        .expect(201);
    });

    it('records a SENT STAFF_TEMP_PASSWORD notification for the new staff email', async () => {
      const notification = await findNotification(
        server,
        adminAccessToken,
        'STAFF_TEMP_PASSWORD',
        staffEmail,
      );
      expect(notification).toBeTruthy();
      expect(notification?.status).toBe('SENT');
    });
  });

  describe('booking + payment notifications', () => {
    const email = `${RUN_ID}.customer@example.com`;
    let token: string;
    let invoiceId: string;

    it('booking a flight records a SENT BOOKING_CONFIRMATION notification', async () => {
      token = await registerAndLogin(server, email, 'Notif');

      const searchRes = await request(server)
        .post('/api/v1/flights/search')
        .set('Authorization', `Bearer ${token}`)
        .send(SEARCH_BODY)
        .expect(201);
      const offerId = searchRes.body.data[0].id as string;

      await request(server)
        .post('/api/v1/flights/bookings/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ offerId, passengers: [{ type: 'ADULT' }] })
        .expect(201);

      const notification = await findNotification(
        server,
        adminAccessToken,
        'BOOKING_CONFIRMATION',
        email,
      );
      expect(notification).toBeTruthy();
      expect(notification?.status).toBe('SENT');
    });

    it('recording a payment records a SENT PAYMENT_RECEIPT notification', async () => {
      const listRes = await request(server)
        .get('/api/v1/invoices/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      invoiceId = listRes.body.data[0].id;

      await request(server)
        .post(`/api/v1/invoices/${invoiceId}/payments`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ amount: 1000, method: 'CASH' })
        .expect(201);

      const notification = await findNotification(
        server,
        adminAccessToken,
        'PAYMENT_RECEIPT',
        email,
      );
      expect(notification).toBeTruthy();
      expect(notification?.status).toBe('SENT');
    });
  });

  describe('admin list permission boundaries', () => {
    it('a plain customer is forbidden from the notifications list (lacks notification:read)', async () => {
      const email = `${RUN_ID}.plain@example.com`;
      const token = await registerAndLogin(server, email, 'Plain');

      await request(server)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('filters the list by status', async () => {
      const res = await request(server)
        .get('/api/v1/notifications?status=SENT')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(
        res.body.data.every((n: { status: string }) => n.status === 'SENT'),
      ).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });
  });
});
