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
