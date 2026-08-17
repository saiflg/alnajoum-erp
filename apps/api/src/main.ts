import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

async function bootstrap() {
  // rawBody: true keeps the original request bytes available (as
  // req.rawBody) alongside the parsed JSON body — needed to verify the
  // Paystack webhook's HMAC signature, which is computed against the exact
  // raw payload, not a re-serialization of the parsed object.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  configureApp(app);

  const port = process.env.PORT ?? 4000;
  await app.listen(port);

  console.log(`Alnajoum ERP API listening on http://localhost:${port}/api/v1`);
}
void bootstrap();
