import { IsString } from 'class-validator';

export class AssignConversationDto {
  @IsString()
  staffId: string;
}
