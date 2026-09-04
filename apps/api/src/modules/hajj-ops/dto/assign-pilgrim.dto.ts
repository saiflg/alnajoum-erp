import { IsString } from 'class-validator';

export class AssignPilgrimToGroupDto {
  @IsString()
  pilgrimId: string;
}
