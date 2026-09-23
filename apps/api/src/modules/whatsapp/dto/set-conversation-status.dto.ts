import { WhatsAppConversationStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class SetConversationStatusDto {
  @IsEnum(WhatsAppConversationStatus)
  status: WhatsAppConversationStatus;
}
