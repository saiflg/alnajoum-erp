import { IsIn, IsOptional, IsString } from 'class-validator';

export class SimulateInboundDto {
  @IsString()
  from: string;

  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsString()
  interactiveReplyId?: string;
}

export class SimulateStatusDto {
  @IsString()
  providerMessageId: string;

  @IsIn(['SENT', 'DELIVERED', 'READ', 'FAILED'])
  status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

  @IsOptional()
  @IsString()
  failureReason?: string;
}
