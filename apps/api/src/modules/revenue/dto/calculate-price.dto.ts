import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CalculatePriceOverrideDto {
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}

export class CalculatePriceDto {
  @IsString()
  product: string;

  @IsInt()
  @Min(0)
  supplierCost: number;

  @IsString()
  @MinLength(3)
  @MaxLength(3)
  currency: string;

  @IsOptional() @IsBoolean() taxIncludedInSupplierCost?: boolean;
  @IsOptional() @IsString() supplierId?: string;
  @IsOptional() @IsString() airlineCode?: string;
  @IsOptional() @IsString() origin?: string;
  @IsOptional() @IsString() destination?: string;
  @IsOptional() @IsString() cabinClass?: string;
  @IsOptional() @IsString() roomType?: string;
  @IsOptional() @IsString() channel?: string;
  @IsOptional() @IsString() customerSegment?: string;
  @IsOptional() @IsString() corporateAccountId?: string;
  @IsOptional() @IsString() agentId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() paymentMethod?: string;
  @IsOptional() @IsInt() @Min(1) @Max(1000) passengers?: number;
  @IsOptional() @IsInt() @Min(0) advanceDays?: number;
  @IsOptional() @IsInt() @Min(0) daysToDeparture?: number;
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  inventoryRemainingPercent?: number;

  /** Only honoured for the super admin; every other caller is pinned to their own tenant. */
  @IsOptional() @IsString() companyId?: string;

  /** The customer a promotion would be redeemed by (for per-customer limits). */
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() promotionCode?: string;

  /** Stores the calculation. Set sourceType+sourceId to freeze it as a booking's commercial snapshot. */
  @IsOptional() @IsBoolean() persist?: boolean;
  @IsOptional() @IsString() sourceType?: string;
  @IsOptional() @IsString() sourceId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CalculatePriceOverrideDto)
  override?: CalculatePriceOverrideDto;
}
