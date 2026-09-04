import { IsString } from 'class-validator';

export class RequestReissueDto {
  @IsString()
  newOfferId: string;
}
