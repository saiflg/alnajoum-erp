import { IsDefined, IsOptional, IsString } from 'class-validator';

export class SetSystemSettingDto {
  // No shape validation beyond "it's present" — a setting's value shape
  // varies entirely by category/key (a number, a boolean, an object of
  // password-policy rules, ...), same looseness as SystemSetting.value
  // itself (Json in the schema). @IsDefined() isn't for shape — without
  // ANY decorator here, the global ValidationPipe's whitelist mode
  // silently strips this field and then forbidNonWhitelisted rejects it
  // as "should not exist", since undecorated properties aren't
  // recognized as part of the DTO at all.
  @IsDefined()
  value: unknown;

  @IsOptional()
  @IsString()
  reason?: string;
}
