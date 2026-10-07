import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

/**
 * Shared app configuration used by both the runtime bootstrap (main.ts) and
 * e2e tests, so tests exercise the exact same pipes/filters/guards as production.
 */
export function configureApp(app: INestApplication): INestApplication {
  // Behind a reverse proxy (Caddy) every request arrives from the proxy's address unless Express is
  // told how many proxy hops to trust; without it all clients share one rate-limit bucket and every
  // audit-log IP is the proxy's. Explicit hop count (never `true`): trusting arbitrary
  // X-Forwarded-For when the API is reachable directly would let anyone pick their own IP.
  const hops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  if (Number.isInteger(hops) && hops > 0) {
    (
      app.getHttpAdapter().getInstance() as {
        set: (k: string, v: unknown) => void;
      }
    ).set('trust proxy', hops);
  }
  app.use(helmet());
  app.use(cookieParser());

  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? 'http://localhost:3000',
    credentials: true,
  });

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());

  return app;
}
