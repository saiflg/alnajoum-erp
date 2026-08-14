import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/bootstrap';

const BOOTSTRAP_ADMIN_EMAIL = 'admin@alnajoum.travel';
const BOOTSTRAP_ADMIN_PASSWORD = 'Alnajoum@2026';

const RUN_ID = `contact-${Date.now().toString(36)}`;

describe('Contact (e2e)', () => {
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

  it('accepts a submission with no auth token at all', async () => {
    const visitorEmail = `${RUN_ID}@example.com`;

    await request(server)
      .post('/api/v1/contact')
      .send({
        name: 'Ada Lovelace',
        email: visitorEmail,
        subject: `Hajj package pricing ${RUN_ID}`,
        message: 'How much for a family of four next Ramadan?',
      })
      .expect(201);

    const listRes = await request(server)
      .get('/api/v1/notifications?type=CONTACT_MESSAGE')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(200);
    const notification = (
      listRes.body.data as Array<{
        subject: string;
        status: string;
        body: string;
      }>
    ).find((n) => n.subject.includes(RUN_ID));

    expect(notification).toBeTruthy();
    expect(notification?.status).toBe('SENT');
    expect(notification?.body).toContain(visitorEmail);
  });

  it('rejects a submission missing required fields', async () => {
    await request(server)
      .post('/api/v1/contact')
      .send({ name: 'Ada' })
      .expect(400);
  });

  it('rejects a submission with an invalid email', async () => {
    await request(server)
      .post('/api/v1/contact')
      .send({
        name: 'Ada',
        email: 'not-an-email',
        subject: 'Hi',
        message: 'Hello',
      })
      .expect(400);
  });
});
