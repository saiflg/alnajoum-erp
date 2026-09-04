import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { BankStatementLineStatus } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { BankReconciliationService } from './bank-reconciliation.service';
import { CreateBankStatementLineDto } from './dto/create-bank-statement-line.dto';
import { MatchBankStatementLineDto } from './dto/match-bank-statement-line.dto';

@Controller('finance/bank-reconciliation')
@RequirePermissions(PERMISSIONS.FINANCE.BANK_RECONCILIATION)
export class BankReconciliationController {
  constructor(
    private readonly service: BankReconciliationService,
    private readonly usersService: UsersService,
  ) {}

  private async requireStaffId(user: AuthContext): Promise<string> {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    if (!staffId) {
      throw new ForbiddenException('Only staff can perform this action');
    }
    return staffId;
  }

  @Post('lines')
  async addLine(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateBankStatementLineDto,
  ) {
    const staffId = await this.requireStaffId(user);
    return this.service.addLine(dto, staffId);
  }

  @Post('lines/bulk')
  async importBulk(
    @CurrentUser() user: AuthContext,
    @Body() body: { lines: CreateBankStatementLineDto[] },
  ) {
    const staffId = await this.requireStaffId(user);
    return this.service.importBulk(body.lines, staffId);
  }

  @Get('lines')
  listAll(@Query('status') status?: BankStatementLineStatus) {
    return this.service.listAll({ status });
  }

  @Get('duplicates')
  findDuplicates() {
    return this.service.findDuplicates();
  }

  @Post('lines/:id/match')
  match(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: MatchBankStatementLineDto,
  ) {
    return this.service.match(id, dto, user.sub);
  }

  @Post('lines/:id/ignore')
  ignore(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.service.ignore(id, user.sub);
  }
}
