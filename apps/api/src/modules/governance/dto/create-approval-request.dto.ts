import { IsInt, IsOptional, IsString, Min } from 'class-validator';

/** Used internally by other services (e.g. FlightRefundsService) to open
 * an approval request — not exposed as a raw public endpoint, since
 * "what needs approval" is always decided by the calling module, not by
 * a client picking an arbitrary type/entity. */
export class CreateApprovalRequestDto {
  @IsString()
  type: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  entityId?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
