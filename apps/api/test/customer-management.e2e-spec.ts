import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import sharp from 'sharp';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/bootstrap';

async function flatJpeg(): Promise<Buffer> {
  return sharp({
    create: {
      width: 400,
      height: 400,
      channels: 3,
      background: { r: 210, g: 210, b: 210 },
    },
  })
    .jpeg()
    .toBuffer();
}

async function noisyJpeg(): Promise<Buffer> {
  const size = 400;
  const raw = Buffer.alloc(size * size * 3);
  for (let i = 0; i < raw.length; i += 1) {
    raw[i] = (i * 2654435761) % 256;
  }
  return sharp(raw, { raw: { width: size, height: size, channels: 3 } })
    .jpeg()
    .toBuffer();
}

const BOOTSTRAP_ADMIN_EMAIL = 'admin@alnajoum.travel';
const BOOTSTRAP_ADMIN_PASSWORD = 'Alnajoum@2026';

// Unique per test run so re-running this suite against the same (non-reset)
// test database never collides with fixtures left over from a prior run.
const RUN_ID = `cust-${Date.now().toString(36)}`;

describe('Customer Management (e2e)', () => {
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

  describe('self-service profile + documents', () => {
    const email = `${RUN_ID}.customer@example.com`;
    let customerAccessToken: string;

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

      const res = await request(server)
        .post('/api/v1/auth/login')
        .send({ email, password: 'Passw0rd1' })
        .expect(201);
      customerAccessToken = res.body.data.accessToken;
    });

    it('exposes the freshly-registered profile via /customers/me', async () => {
      const res = await request(server)
        .get('/api/v1/customers/me')
        .set('Authorization', `Bearer ${customerAccessToken}`)
        .expect(200);

      expect(res.body.data.firstName).toBe('Amina');
      expect(res.body.data.identity.email).toBe(email);
      expect(res.body.data.documents).toEqual([]);
    });

    it('lets the customer update their own profile', async () => {
      const res = await request(server)
        .patch('/api/v1/customers/me')
        .set('Authorization', `Bearer ${customerAccessToken}`)
        .send({
          nationality: 'Nigerian',
          city: 'Lagos',
          country: 'Nigeria',
          passportNumber: 'A1234567',
          passportExpiryDate: '2030-01-01',
        })
        .expect(200);

      expect(res.body.data.nationality).toBe('Nigerian');
      expect(res.body.data.passportNumber).toBe('A1234567');
    });

    it('rejects an unauthenticated profile request', async () => {
      await request(server).get('/api/v1/customers/me').expect(401);
    });

    let documentId: string;
    let passportBytes: Buffer;

    it('uploads a passport document', async () => {
      passportBytes = await noisyJpeg();
      const res = await request(server)
        .post('/api/v1/customers/me/documents?type=PASSPORT')
        .set('Authorization', `Bearer ${customerAccessToken}`)
        .attach('file', passportBytes, {
          filename: 'passport.jpg',
          contentType: 'image/jpeg',
        })
        .expect(201);

      expect(res.body.data.type).toBe('PASSPORT');
      expect(res.body.data.originalFileName).toBe('passport.jpg');
      documentId = res.body.data.id;
    });

    it('rejects an unsupported file type', async () => {
      await request(server)
        .post('/api/v1/customers/me/documents?type=PASSPORT')
        .set('Authorization', `Bearer ${customerAccessToken}`)
        .attach('file', Buffer.from('#!/bin/sh\necho hi'), {
          filename: 'script.sh',
          contentType: 'application/x-sh',
        })
        .expect(400);
    });

    it('lists the uploaded document', async () => {
      const res = await request(server)
        .get('/api/v1/customers/me/documents')
        .set('Authorization', `Bearer ${customerAccessToken}`)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(documentId);
    });

    it('downloads the uploaded document with the correct content type', async () => {
      const res = await request(server)
        .get(`/api/v1/customers/me/documents/${documentId}/file`)
        .set('Authorization', `Bearer ${customerAccessToken}`)
        .expect(200);

      expect(res.headers['content-type']).toContain('image/jpeg');
      expect(Buffer.compare(res.body, passportBytes)).toBe(0);
    });

    it('deletes the uploaded document', async () => {
      await request(server)
        .delete(`/api/v1/customers/me/documents/${documentId}`)
        .set('Authorization', `Bearer ${customerAccessToken}`)
        .expect(200);

      const res = await request(server)
        .get('/api/v1/customers/me/documents')
        .set('Authorization', `Bearer ${customerAccessToken}`)
        .expect(200);
      expect(res.body.data).toEqual([]);
    });
  });

  describe('cross-customer access boundaries', () => {
    const emailA = `${RUN_ID}.customerA@example.com`;
    const emailB = `${RUN_ID}.customerB@example.com`;
    let tokenA: string;
    let tokenB: string;
    let documentIdA: string;

    it('registers two independent customers', async () => {
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
    });

    it('customer A uploads a document', async () => {
      const res = await request(server)
        .post('/api/v1/customers/me/documents?type=NATIONAL_ID')
        .set('Authorization', `Bearer ${tokenA}`)
        .attach('file', Buffer.from('customer-a-id'), {
          filename: 'id.png',
          contentType: 'image/png',
        })
        .expect(201);
      documentIdA = res.body.data.id;
    });

    it("customer B cannot download customer A's document via their own /me route", async () => {
      await request(server)
        .get(`/api/v1/customers/me/documents/${documentIdA}/file`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(403);
    });

    it("customer B cannot delete customer A's document via their own /me route", async () => {
      await request(server)
        .delete(`/api/v1/customers/me/documents/${documentIdA}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(403);
    });

    it('customer B is forbidden from the admin customer list (lacks customer:read)', async () => {
      await request(server)
        .get('/api/v1/customers')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(403);
    });
  });

  describe('passport image quality validation', () => {
    const email = `${RUN_ID}.blurtest@example.com`;
    let token: string;

    it('registers and logs in a customer for the blur-detection checks', async () => {
      await request(server)
        .post('/api/v1/auth/register')
        .send({
          email,
          password: 'Passw0rd1',
          firstName: 'Blur',
          lastName: 'Test',
        })
        .expect(201);

      token = (
        await request(server)
          .post('/api/v1/auth/login')
          .send({ email, password: 'Passw0rd1' })
      ).body.data.accessToken;
    });

    it('rejects a flat/blurry image uploaded as a passport', async () => {
      const res = await request(server)
        .post('/api/v1/customers/me/documents?type=PASSPORT')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', await flatJpeg(), {
          filename: 'blurry-passport.jpg',
          contentType: 'image/jpeg',
        })
        .expect(400);

      expect(res.body.message).toMatch(/blurry|unclear/i);
    });

    it('accepts a sharp/high-detail image uploaded as a passport', async () => {
      await request(server)
        .post('/api/v1/customers/me/documents?type=PASSPORT')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', await noisyJpeg(), {
          filename: 'clear-passport.jpg',
          contentType: 'image/jpeg',
        })
        .expect(201);
    });

    it('does not apply the blur check to non-passport document types', async () => {
      await request(server)
        .post('/api/v1/customers/me/documents?type=NATIONAL_ID')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', await flatJpeg(), {
          filename: 'blurry-id.jpg',
          contentType: 'image/jpeg',
        })
        .expect(201);
    });
  });

  describe('admin management + role boundaries', () => {
    const staffEmail = `${RUN_ID}.branchmgr@testtravel.example`;
    const customerEmail = `${RUN_ID}.managed@example.com`;
    let companyId: string;
    let branchManagerToken: string;
    let customerId: string;

    it('sets up a company, branch, and branch manager for boundary checks', async () => {
      const companyRes = await request(server)
        .post('/api/v1/companies')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ name: `Customer Mgmt Test Co ${RUN_ID}` })
        .expect(201);
      companyId = companyRes.body.data.id;

      await request(server)
        .post('/api/v1/branches')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ companyId, name: 'Test Branch', code: `TB-${RUN_ID}` })
        .expect(201);

      const rolesRes = await request(server)
        .get('/api/v1/rbac/roles')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);
      const branchManagerRoleId = rolesRes.body.data.find(
        (r: { name: string }) => r.name === 'BRANCH_MANAGER',
      ).id;

      const createRes = await request(server)
        .post('/api/v1/staff')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          email: staffEmail,
          firstName: 'Branch',
          lastName: 'Mgr',
          companyId,
          employeeCode: `BM-${RUN_ID}`,
          roleId: branchManagerRoleId,
        })
        .expect(201);

      const loginRes = await request(server)
        .post('/api/v1/auth/login')
        .send({
          email: staffEmail,
          password: createRes.body.data.temporaryPassword,
        })
        .expect(201);
      branchManagerToken = loginRes.body.data.accessToken;
    });

    it('registers the customer to be managed', async () => {
      await request(server)
        .post('/api/v1/auth/register')
        .send({
          email: customerEmail,
          password: 'Passw0rd1',
          firstName: 'Kemi',
          lastName: 'A',
        })
        .expect(201);

      const res = await request(server)
        .get('/api/v1/customers')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);
      const created = res.body.data.find(
        (c: { identity: { email: string } }) =>
          c.identity.email === customerEmail,
      );
      expect(created).toBeDefined();
      customerId = created.id;
    });

    it('admin can view and update the customer', async () => {
      await request(server)
        .get(`/api/v1/customers/${customerId}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      const res = await request(server)
        .patch(`/api/v1/customers/${customerId}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ city: 'Abuja' })
        .expect(200);
      expect(res.body.data.city).toBe('Abuja');
    });

    it('branch manager can read but not update or delete customers', async () => {
      await request(server)
        .get('/api/v1/customers')
        .set('Authorization', `Bearer ${branchManagerToken}`)
        .expect(200);

      await request(server)
        .patch(`/api/v1/customers/${customerId}`)
        .set('Authorization', `Bearer ${branchManagerToken}`)
        .send({ city: 'Should not be allowed' })
        .expect(403);

      await request(server)
        .delete(`/api/v1/customers/${customerId}`)
        .set('Authorization', `Bearer ${branchManagerToken}`)
        .expect(403);
    });

    it("admin can view the managed customer's documents via the admin route", async () => {
      const res = await request(server)
        .get(`/api/v1/customers/${customerId}/documents`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);
      expect(res.body.data).toEqual([]);
    });

    it('admin deactivates the customer, which then blocks their login', async () => {
      await request(server)
        .delete(`/api/v1/customers/${customerId}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      await request(server)
        .post('/api/v1/auth/login')
        .send({ email: customerEmail, password: 'Passw0rd1' })
        .expect(401);
    });
  });
});
