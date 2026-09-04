import { TicketPriority } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateTicketDto {
  @IsString()
  @MaxLength(200)
  subject: string;

  @IsString()
  categoryId: string;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @IsString()
  @MaxLength(5000)
  description: string;
}
