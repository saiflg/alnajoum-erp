import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import sharp from 'sharp';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/bootstrap';

async function flatJpeg(): Promise<Buffer> {
  return sharp({
    create: { width: 400, height: 400, channels: 3, background: { r: 210, g: 210, b: 210 } },
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
  return sharp(raw, { raw: { width: size, height: size, channels: 3 } }).jpeg().toBuffer();
}

const BOOTSTRAP_ADMIN_EMAIL = 'admin@alnajoum.travel';
const BOOTSTRAP_ADMIN_PASSWORD = 'Alnajoum@2026';

const RUN_ID = `fam-${Date.now().toString(36)}`;

describe('Family Management (e2e)', () => {
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
      .send({ email: BOOTSTRAP_ADMIN_EMAIL, password: BOOTSTRAP_ADMIN_PASSWORD })
      .expect(201);
    adminAccessToken = res.body.data.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('self-service family members + documents', () => {
    const email = `${RUN_ID}.customer@example.com`;
    let customerToken: string;
    let memberId: string;
    let documentId: string;

    it('registers and logs the customer in', async () => {
      await request(server)
        .post('/api/v1/auth/register')
        .send({ email, password: 'Passw0rd1', firstName: 'Amina', lastName: 'Bello' })
        .expect(201);

      const res = await request(server)
        .post('/api/v1/auth/login')
        .send({ email, password: 'Passw0rd1' })
        .expect(201);
      customerToken = res.body.data.accessToken;
    });

    it('creates a family member', async () => {
      const res = await request(server)
        .post('/api/v1/customers/me/family-members')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          relationship: 'CHILD',
          firstName: 'Zara',
          lastName: 'Bello',
          dateOfBirth: '2015-06-01',
        })
        .expect(201);

      expect(res.body.data.relationship).toBe('CHILD');
      memberId = res.body.data.id;
    });

    it('lists own family members', async () => {
      const res = await request(server)
        .get('/api/v1/customers/me/family-members')
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(memberId);
    });

    it('rejects an unauthenticated request', async () => {
      await request(server).get('/api/v1/customers/me/family-members').expect(401);
    });

    it('updates the family member', async () => {
      const res = await request(server)
        .patch(`/api/v1/customers/me/family-members/${memberId}`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ nationality: 'Nigerian' })
        .expect(200);

      expect(res.body.data.nationality).toBe('Nigerian');
    });

    let passportBytes: Buffer;

    it('uploads a document for the family member', async () => {
      passportBytes = await noisyJpeg();
      const res = await request(server)
        .post(`/api/v1/customers/me/family-members/${memberId}/documents?type=PASSPORT`)
        .set('Authorization', `Bearer ${customerToken}`)
        .attach('file', passportBytes, {
          filename: 'zara-passport.jpg',
          contentType: 'image/jpeg',
        })
        .expect(201);

      expect(res.body.data.type).toBe('PASSPORT');
      documentId = res.body.data.id;
    });

    it('lists and downloads the uploaded document', async () => {
      const listRes = await request(server)
        .get(`/api/v1/customers/me/family-members/${memberId}/documents`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);
      expect(listRes.body.data).toHaveLength(1);

      const fileRes = await request(server)
        .get(`/api/v1/customers/me/family-members/${memberId}/documents/${documentId}/file`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);
      expect(fileRes.headers['content-type']).toContain('image/jpeg');
      expect(Buffer.compare(fileRes.body, passportBytes)).toBe(0);
    });

    it('deletes the document, then the family member', async () => {
      await request(server)
        .delete(`/api/v1/customers/me/family-members/${memberId}/documents/${documentId}`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);

      await request(server)
        .delete(`/api/v1/customers/me/family-members/${memberId}`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);

      const res = await request(server)
        .get('/api/v1/customers/me/family-members')
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);
      expect(res.body.data).toEqual([]);
    });
  });

  describe('passport image quality validation for family member documents', () => {
    const email = `${RUN_ID}.blurtest@example.com`;
    let token: string;
    let memberId: string;

    it('registers a customer and adds a family member', async () => {
      await request(server)
        .post('/api/v1/auth/register')
        .send({ email, password: 'Passw0rd1', firstName: 'Blur', lastName: 'Test' })
        .expect(201);

      token = (
        await request(server)
          .post('/api/v1/auth/login')
          .send({ email, password: 'Passw0rd1' })
      ).body.data.accessToken;

      const res = await request(server)
        .post('/api/v1/customers/me/family-members')
        .set('Authorization', `Bearer ${token}`)
        .send({ relationship: 'CHILD', firstName: 'Kid', lastName: 'Test' })
        .expect(201);
      memberId = res.body.data.id;
    });

    it("rejects a flat/blurry image uploaded as the family member's passport", async () => {
      await request(server)
        .post(`/api/v1/customers/me/family-members/${memberId}/documents?type=PASSPORT`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', await flatJpeg(), {
          filename: 'blurry-passport.jpg',
          contentType: 'image/jpeg',
        })
        .expect(400);
    });
  });

  describe('cross-customer access boundaries', () => {
    const emailA = `${RUN_ID}.customerA@example.com`;
    const emailB = `${RUN_ID}.customerB@example.com`;
    let tokenA: string;
    let tokenB: string;
    let memberIdA: string;

    it('registers two independent customers and customer A creates a family member', async () => {
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

      const res = await request(server)
        .post('/api/v1/customers/me/family-members')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ relationship: 'SPOUSE', firstName: 'Partner', lastName: 'A' })
        .expect(201);
      memberIdA = res.body.data.id;
    });

    it("customer B cannot view customer A's family member", async () => {
      await request(server)
        .get(`/api/v1/customers/me/family-members/${memberIdA}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(403);
    });

    it("customer B cannot update or delete customer A's family member", async () => {
      await request(server)
        .patch(`/api/v1/customers/me/family-members/${memberIdA}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ firstName: 'Hijacked' })
        .expect(403);

      await request(server)
        .delete(`/api/v1/customers/me/family-members/${memberIdA}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(403);
    });

    it("customer B cannot upload a document to customer A's family member", async () => {
      await request(server)
        .post(`/api/v1/customers/me/family-members/${memberIdA}/documents?type=OTHER`)
        .set('Authorization', `Bearer ${tokenB}`)
        .attach('file', Buffer.from('nope'), { filename: 'x.png', contentType: 'image/png' })
        .expect(403);
    });
  });

  describe('admin management + role boundaries', () => {
    const staffEmail = `${RUN_ID}.branchmgr@testtravel.example`;
    const customerEmail = `${RUN_ID}.managed@example.com`;
    let companyId: string;
    let branchManagerToken: string;
    let customerId: string;
    let memberId: string;

    it('sets up a company, branch, and branch manager for boundary checks', async () => {
      const companyRes = await request(server)
        .post('/api/v1/companies')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ name: `Family Mgmt Test Co ${RUN_ID}` })
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
        .send({ email: staffEmail, password: createRes.body.data.temporaryPassword })
        .expect(201);
      branchManagerToken = loginRes.body.data.accessToken;
    });

    it('registers the customer to be managed', async () => {
      await request(server)
        .post('/api/v1/auth/register')
        .send({ email: customerEmail, password: 'Passw0rd1', firstName: 'Kemi', lastName: 'A' })
        .expect(201);

      const res = await request(server)
        .get('/api/v1/customers')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);
      const created = res.body.data.find(
        (c: { identity: { email: string } }) => c.identity.email === customerEmail,
      );
      customerId = created.id;
    });

    it('admin can create and view a family member for the customer', async () => {
      const res = await request(server)
        .post(`/api/v1/customers/${customerId}/family-members`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ relationship: 'PARENT', firstName: 'Tunde', lastName: 'A' })
        .expect(201);
      memberId = res.body.data.id;

      await request(server)
        .get(`/api/v1/customers/${customerId}/family-members/${memberId}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);
    });

    it('branch manager can read but not create, update, or delete family members', async () => {
      await request(server)
        .get(`/api/v1/customers/${customerId}/family-members`)
        .set('Authorization', `Bearer ${branchManagerToken}`)
        .expect(200);

      await request(server)
        .post(`/api/v1/customers/${customerId}/family-members`)
        .set('Authorization', `Bearer ${branchManagerToken}`)
        .send({ relationship: 'OTHER', firstName: 'Should', lastName: 'Fail' })
        .expect(403);

      await request(server)
        .patch(`/api/v1/customers/${customerId}/family-members/${memberId}`)
        .set('Authorization', `Bearer ${branchManagerToken}`)
        .send({ firstName: 'Should not change' })
        .expect(403);

      await request(server)
        .delete(`/api/v1/customers/${customerId}/family-members/${memberId}`)
        .set('Authorization', `Bearer ${branchManagerToken}`)
        .expect(403);
    });

    it('admin can delete the family member', async () => {
      await request(server)
        .delete(`/api/v1/customers/${customerId}/family-members/${memberId}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      const res = await request(server)
        .get(`/api/v1/customers/${customerId}/family-members`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);
      expect(res.body.data).toEqual([]);
    });
  });
});
