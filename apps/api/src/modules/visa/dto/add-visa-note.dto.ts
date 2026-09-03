import { IsString, MinLength } from 'class-validator';

export class AddVisaNoteDto {
  @IsString()
  @MinLength(1)
  note: string;
}
