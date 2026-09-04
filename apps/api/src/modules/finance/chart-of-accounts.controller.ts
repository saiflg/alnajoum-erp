import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AccountType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { LedgerService } from './ledger.service';

class CreateAccountDto {
  @IsString()
  @MaxLength(20)
  code: string;

  @IsString()
  @MaxLength(200)
  name: string;

  @IsEnum(AccountType)
  type: AccountType;

  @IsOptional()
  @IsString()
  branchId?: string;
}

/** Spec #2/#26. Reading (LEDGER_VIEW) is broader than creating accounts (ACCOUNTS_MANAGE — Company Admin+). */
@Controller('finance/accounts')
export class ChartOfAccountsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FINANCE.LEDGER_VIEW)
  list() {
    return this.prisma.ledgerAccount.findMany({ orderBy: { code: 'asc' } });
  }

  @Get('trial-balance')
  @RequirePermissions(PERMISSIONS.FINANCE.LEDGER_VIEW)
  trialBalance(@Query('asOf') asOf?: string) {
    return this.ledger.trialBalance(asOf ? new Date(asOf) : undefined);
  }

  @Get('journal-entries')
  @RequirePermissions(PERMISSIONS.FINANCE.LEDGER_VIEW)
  journalEntries(
    @Query('sourceModule') sourceModule?: string,
    @Query('sourceId') sourceId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.ledger.listEntries({
      sourceModule,
      sourceId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
  }

  @Post()
  @RequirePermissions(PERMISSIONS.FINANCE.ACCOUNTS_MANAGE)
  create(@Body() dto: CreateAccountDto) {
    return this.prisma.ledgerAccount.create({
      data: {
        code: dto.code,
        name: dto.name,
        type: dto.type,
        branchId: dto.branchId,
        isSystem: false,
      },
    });
  }

  @Post('journal-entries/:id/reverse')
  @RequirePermissions(PERMISSIONS.FINANCE.ACCOUNTS_MANAGE)
  reverseEntry(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    return this.ledger.reverseEntry(id, body.reason, user.sub);
  }
}
