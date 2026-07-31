import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/bootstrap';

const BOOTSTRAP_ADMIN_EMAIL = 'admin@alnajoum.travel';
const BOOTSTRAP_ADMIN_PASSWORD = 'Alnajoum@2026';

// Unique per test run so re-running this suite against the same (non-reset)
// test database never collides with fixtures left over from a prior run.
const RUN_ID = Date.now().toString(36);

describe('Auth + RBAC + Company/Branch/Staff flow (e2e)', () => {
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
  });

  afterAll(async () => {
    await app.close();
  });

  it('logs in the seeded Super Admin and returns full access', async () => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: BOOTSTRAP_ADMIN_EMAIL, password: BOOTSTRAP_ADMIN_PASSWORD })
      .expect(201);

    expect(res.body.data.identity.roles).toContain('SUPER_ADMIN');
    expect(res.body.data.identity.dashboardPath).toBe('/admin/dashboard');
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.refreshToken).toBeDefined();

    adminAccessToken = res.body.data.accessToken;
  });

  it('rejects a wrong password', async () => {
    await request(server)
      .post('/api/v1/auth/login')
      .send({ email: BOOTSTRAP_ADMIN_EMAIL, password: 'WrongPassword1' })
      .expect(401);
  });

  it('exposes the authenticated profile via /auth/me', async () => {
    const res = await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(200);

    expect(res.body.data.email).toBe(BOOTSTRAP_ADMIN_EMAIL);
    expect(res.body.data.permissions).toEqual(
      expect.arrayContaining(['company:create', 'branch:create', 'staff:create']),
    );
  });

  let companyId: string;
  let branchId: string;
  let branchManagerRoleId: string;
  let staffTemporaryPassword: string;
  let staffEmail: string;

  it('creates a company', async () => {
    const res = await request(server)
      .post('/api/v1/companies')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Test Travel Co', email: 'ops@testtravel.example' })
      .expect(201);

    expect(res.body.data.name).toBe('Test Travel Co');
    companyId = res.body.data.id;
  });

  it('creates a branch under the company', async () => {
    const res = await request(server)
      .post('/api/v1/branches')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ companyId, name: 'Lagos Branch', code: 'LAG', city: 'Lagos' })
      .expect(201);

    expect(res.body.data.companyId).toBe(companyId);
    branchId = res.body.data.id;
  });

  it('rejects a duplicate branch code within the same company', async () => {
    await request(server)
      .post('/api/v1/branches')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ companyId, name: 'Duplicate Branch', code: 'LAG' })
      .expect(409);
  });

  it('looks up the BRANCH_MANAGER system role', async () => {
    const res = await request(server)
      .get('/api/v1/rbac/roles')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(200);

    const role = res.body.data.find((r: { name: string }) => r.name === 'BRANCH_MANAGER');
    expect(role).toBeDefined();
    branchManagerRoleId = role.id;
  });

  it('creates a staff member scoped to the branch with the BRANCH_MANAGER role', async () => {
    staffEmail = `branch.manager.${RUN_ID}@testtravel.example`;
    const res = await request(server)
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        email: staffEmail,
        firstName: 'Bola',
        lastName: 'Adeyemi',
        companyId,
        branchId,
        employeeCode: `LAG-MGR-${RUN_ID}`,
        roleId: branchManagerRoleId,
      })
      .expect(201);

    expect(res.body.data.staff.branchId).toBe(branchId);
    expect(res.body.data.temporaryPassword).toMatch(/^Tmp.+!$/);
    staffTemporaryPassword = res.body.data.temporaryPassword;
  });

  it('rejects creating a second staff member with the same email', async () => {
    await request(server)
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        email: staffEmail,
        firstName: 'Dup',
        lastName: 'Licate',
        companyId,
        branchId,
        employeeCode: `LAG-MGR-DUP-${RUN_ID}`,
        roleId: branchManagerRoleId,
      })
      .expect(409);
  });

  let managerAccessToken: string;

  it('logs the new branch manager in with the temporary password', async () => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: staffEmail, password: staffTemporaryPassword })
      .expect(201);

    expect(res.body.data.identity.roles).toEqual(['BRANCH_MANAGER']);
    expect(res.body.data.identity.dashboardPath).toBe('/branch/dashboard');
    managerAccessToken = res.body.data.accessToken;
  });

  it('lets the branch manager read branches', async () => {
    await request(server)
      .get('/api/v1/branches')
      .set('Authorization', `Bearer ${managerAccessToken}`)
      .expect(200);
  });

  it('forbids the branch manager from creating a company', async () => {
    await request(server)
      .post('/api/v1/companies')
      .set('Authorization', `Bearer ${managerAccessToken}`)
      .send({ name: 'Should not be allowed' })
      .expect(403);
  });

  it('forbids the branch manager from deleting staff', async () => {
    await request(server)
      .delete(`/api/v1/staff/does-not-matter`)
      .set('Authorization', `Bearer ${managerAccessToken}`)
      .expect(403);
  });

  describe('refresh token rotation', () => {
    let refreshToken: string;

    it('logs in and captures the refresh token', async () => {
      const res = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: BOOTSTRAP_ADMIN_EMAIL, password: BOOTSTRAP_ADMIN_PASSWORD })
        .expect(201);
      refreshToken = res.body.data.refreshToken;
    });

    it('issues a new token pair from a valid refresh token', async () => {
      const res = await request(server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(201);

      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.refreshToken).not.toBe(refreshToken);
    });

    it('rejects reusing an already-rotated refresh token', async () => {
      await request(server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(401);
    });
  });

  describe('logout', () => {
    it('revokes the refresh token so it can no longer be used', async () => {
      const loginRes = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: BOOTSTRAP_ADMIN_EMAIL, password: BOOTSTRAP_ADMIN_PASSWORD })
        .expect(201);
      const refreshToken = loginRes.body.data.refreshToken;

      await request(server)
        .post('/api/v1/auth/logout')
        .send({ refreshToken })
        .expect(201);

      await request(server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(401);
    });
  });

  describe('customer self-registration', () => {
    const customerEmail = `traveller.${RUN_ID}@example.com`;

    it('registers a customer with only the CUSTOMER role', async () => {
      const res = await request(server)
        .post('/api/v1/auth/register')
        .send({
          email: customerEmail,
          password: 'Passw0rd1',
          firstName: 'Amina',
          lastName: 'Bello',
        })
        .expect(201);

      expect(res.body.data.identity.type).toBe('CUSTOMER');
      expect(res.body.data.identity.roles).toEqual(['CUSTOMER']);
      expect(res.body.data.identity.dashboardPath).toBe('/portal/dashboard');
    });

    it('rejects a duplicate customer registration', async () => {
      await request(server)
        .post('/api/v1/auth/register')
        .send({
          email: customerEmail,
          password: 'Passw0rd1',
          firstName: 'Amina',
          lastName: 'Bello',
        })
        .expect(409);
    });

    it('rejects a weak password at the validation layer', async () => {
      await request(server)
        .post('/api/v1/auth/register')
        .send({
          email: 'weakpass@example.com',
          password: 'short',
          firstName: 'A',
          lastName: 'B',
        })
        .expect(400);
    });
  });
});
