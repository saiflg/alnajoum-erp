import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 4000;

  @IsString()
  DATABASE_URL: string;

  @IsOptional()
  @IsString()
  REDIS_URL?: string;

  @IsString()
  JWT_ACCESS_SECRET: string;

  @IsString()
  JWT_ACCESS_EXPIRES_IN: string = '15m';

  @IsString()
  JWT_REFRESH_SECRET: string;

  @IsString()
  JWT_REFRESH_EXPIRES_IN: string = '7d';

  @IsString()
  CORS_ORIGIN: string = 'http://localhost:3000';

  @IsString()
  UPLOADS_DIR: string = './uploads';

  @IsOptional()
  @IsInt()
  @Min(1)
  DOCUMENT_BLUR_THRESHOLD?: number;

  @IsOptional()
  @IsString()
  FLIGHT_PROVIDER?: string; // 'mock' (default) | 'duffel'

  @IsOptional()
  @IsString()
  NOTIFICATION_PROVIDER?: string; // 'mock' (default) | 'smtp'

  @IsOptional()
  @IsString()
  SMTP_HOST?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  SMTP_PORT?: number;

  @IsOptional()
  @IsString()
  SMTP_SECURE?: string;

  @IsOptional()
  @IsString()
  SMTP_USER?: string;

  @IsOptional()
  @IsString()
  SMTP_PASSWORD?: string;

  @IsOptional()
  @IsString()
  SMTP_FROM?: string;

  @IsOptional()
  @IsString()
  CONTACT_RECIPIENT_EMAIL?: string;

  @IsOptional()
  @IsString()
  PAYMENT_PROVIDER?: string; // 'mock' (default) | 'paystack' | 'opay'

  @IsOptional()
  @IsString()
  PAYSTACK_SECRET_KEY?: string;

  @IsOptional()
  @IsString()
  OPAY_SECRET_KEY?: string;

  @IsOptional()
  @IsString()
  OPAY_MERCHANT_ID?: string;

  // The web app's own public origin — used to build the checkout callback
  // URL the customer's browser is sent back to, and (for the mock
  // provider) the mock checkout page's URL. Deliberately separate from
  // CORS_ORIGIN, which may be a comma-separated allowlist.
  @IsOptional()
  @IsString()
  PUBLIC_WEB_ORIGIN?: string;
}

export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    const messages = errors
      .map((error) => Object.values(error.constraints ?? {}).join(', '))
      .join('; ');
    throw new Error(`Environment validation failed: ${messages}`);
  }

  return validated;
}
