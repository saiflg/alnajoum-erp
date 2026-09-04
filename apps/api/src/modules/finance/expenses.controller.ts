import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ExpenseStatus } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { createDocumentMulterOptions } from '../../common/documents/document-storage.util';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { ReviewExpenseDto } from './dto/review-expense.dto';
import { ExpensesService } from './expenses.service';

const NAMESPACE = 'expense-receipts';

@Controller('finance/expenses')
export class ExpensesController {
  constructor(
    private readonly expensesService: ExpensesService,
    private readonly usersService: UsersService,
  ) {}

  private async requireStaffId(user: AuthContext): Promise<string> {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    if (!staffId) {
      throw new ForbiddenException('Only staff can perform this action');
    }
    return staffId;
  }

  @Post()
  @RequirePermissions(PERMISSIONS.FINANCE.EXPENSE_CREATE)
  async create(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateExpenseDto,
  ) {
    const staffId = await this.requireStaffId(user);
    return this.expensesService.create(dto, staffId, user.sub);
  }

  @Post(':id/receipt')
  @RequirePermissions(PERMISSIONS.FINANCE.EXPENSE_CREATE)
  @UseInterceptors(
    FileInterceptor('file', createDocumentMulterOptions(NAMESPACE)),
  )
  attachReceipt(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.expensesService.attachReceipt(id, file.filename);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.FINANCE.EXPENSE_APPROVE)
  listAll(
    @Query('status') status?: ExpenseStatus,
    @Query('branchId') branchId?: string,
    @Query('category') category?: string,
  ) {
    return this.expensesService.listAll({ status, branchId, category });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.FINANCE.EXPENSE_APPROVE)
  get(@Param('id') id: string) {
    return this.expensesService.get(id);
  }

  @Post(':id/approve')
  @RequirePermissions(PERMISSIONS.FINANCE.EXPENSE_APPROVE)
  async approve(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    const staffId = await this.requireStaffId(user);
    return this.expensesService.approve(id, staffId, user.sub);
  }

  @Post(':id/reject')
  @RequirePermissions(PERMISSIONS.FINANCE.EXPENSE_APPROVE)
  async reject(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: ReviewExpenseDto,
  ) {
    return this.expensesService.reject(
      id,
      dto.reason ?? 'No reason given',
      user.sub,
    );
  }

  @Post(':id/pay')
  @RequirePermissions(PERMISSIONS.FINANCE.EXPENSE_APPROVE)
  async markPaid(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.expensesService.markPaid(id, user.sub);
  }
}
