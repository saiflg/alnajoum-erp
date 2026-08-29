import { IsObject, IsOptional } from 'class-validator';

/**
 * config is intentionally a free-form object — each provider has its own
 * secret field names (Duffel: apiKey; Paystack: secretKey; SMTP: host/port/
 * user/password/from/secure). Validated shape-per-provider would mean one
 * DTO per provider for very little real safety benefit here, since these
 * are admin-only, server-side-only values that are never rendered back.
 */
export class UpsertCredentialDto {
  @IsObject()
  @IsOptional()
  config?: Record<string, string>;
}
