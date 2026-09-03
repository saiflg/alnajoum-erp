import { IsString } from 'class-validator';

export class AssignVisaApplicationDto {
  @IsString()
  staffId: string;
}
