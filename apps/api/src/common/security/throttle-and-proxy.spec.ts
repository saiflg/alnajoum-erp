import { Controller, INestApplication, Ip, Post, Get } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Throttle, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { configureApp } from '../../bootstrap';
import { CREDENTIAL_THROTTLE } from './throttle-limits';

@Controller('probe')
class ProbeController {
  @Post('login')
  @Throttle(CREDENTIAL_THROTTLE)
  login() {
    return { ok: true };
  }

  @Get('ip')
  ip(@Ip() ip: string) {
    return { ip };
  }
}

async function makeApp(trustHops?: string): Promise<INestApplication> {
  if (trustHops === undefined) delete process.env.TRUST_PROXY_HOPS;
  else process.env.TRUST_PROXY_HOPS = trustHops;
  const moduleRef = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])],
    controllers: [ProbeController],
    providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
  }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

jest.setTimeout(60_000);

describe('credential throttling and proxy trust (Phase 22 S-19)', () => {
  const saved = process.env.TRUST_PROXY_HOPS;
  afterAll(() => {
    if (saved === undefined) delete process.env.TRUST_PROXY_HOPS;
    else process.env.TRUST_PROXY_HOPS = saved;
  });

  it('allows 10 credential attempts a minute from one address, then answers 429', async () => {
    const app = await makeApp();
    const server = app.getHttpServer();
    for (let i = 0; i < 10; i++) {
      await request(server).post('/api/v1/probe/login').expect(201);
    }
    await request(server).post('/api/v1/probe/login').expect(429);
    await app.close();
  });

  it('with no trusted proxy, X-Forwarded-For is ignored: one client cannot dodge the limit by rotating it', async () => {
    const app = await makeApp(undefined);
    const server = app.getHttpServer();
    for (let i = 0; i < 10; i++) {
      await request(server)
        .post('/api/v1/probe/login')
        .set('X-Forwarded-For', `203.0.113.${i}`)
        .expect(201);
    }
    await request(server)
      .post('/api/v1/probe/login')
      .set('X-Forwarded-For', '203.0.113.200')
      .expect(429);
    await app.close();
  });

  it('behind one trusted proxy, clients are told apart by the address the proxy reports', async () => {
    const app = await makeApp('1');
    const server = app.getHttpServer();
    // Client A exhausts its bucket...
    for (let i = 0; i < 10; i++) {
      await request(server)
        .post('/api/v1/probe/login')
        .set('X-Forwarded-For', '198.51.100.1')
        .expect(201);
    }
    await request(server)
      .post('/api/v1/probe/login')
      .set('X-Forwarded-For', '198.51.100.1')
      .expect(429);
    // ...and client B, through the same proxy, is unaffected.
    await request(server)
      .post('/api/v1/probe/login')
      .set('X-Forwarded-For', '198.51.100.2')
      .expect(201);
    const res = await request(server)
      .get('/api/v1/probe/ip')
      .set('X-Forwarded-For', '198.51.100.7');
    expect(
      (res.body as { data?: { ip?: string }; ip?: string }).data?.ip ??
        (res.body as { ip?: string }).ip,
    ).toBe('198.51.100.7');
    await app.close();
  });
});
