import { PartialType, PickType } from '@nestjs/mapped-types';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { CreatePromotionDto } from './create-promotion.dto';

/** Only presentation and limits are editable; mode/value/code are fixed once created so past redemptions stay meaningful. */
export class UpdatePromotionDto extends PartialType(
  PickType(CreatePromotionDto, [
    'name',
    'endsAt',
    'isActive',
    'minBookingAmount',
    'maxDiscountAmount',
    'totalUsageLimit',
    'perCustomerLimit',
    'budget',
    'products',
    'channels',
  ] as const),
) {}

export class PromotionCheckDto {
  @IsString() product: string;
  @IsInt() @Min(0) bookingAmount: number;
  @IsOptional() @IsString() channel?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() customerId?: string;
}

export class RedeemPromotionDto extends PromotionCheckDto {
  @IsString() sourceType: string;
  @IsString() sourceId: string;
}
