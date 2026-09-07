import { IsOptional, IsString } from 'class-validator';

export class SetSystemSettingDto {
  // No shape validation beyond "it's JSON" — a setting's value shape
  // varies entirely by category/key (a number, a boolean, an object of
  // password-policy rules, ...), same looseness as SystemSetting.value
  // itself (Json in the schema).
  value: unknown;

  @IsOptional()
  @IsString()
  reason?: string;
}
