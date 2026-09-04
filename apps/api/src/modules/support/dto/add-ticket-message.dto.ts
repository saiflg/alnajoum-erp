import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class AddTicketMessageDto {
  @IsString()
  @MaxLength(5000)
  message: string;

  /** Staff-only — a customer's own message can never be marked internal (the controller enforces this, not the DTO). */
  @IsOptional()
  @IsBoolean()
  isInternal?: boolean;
}
